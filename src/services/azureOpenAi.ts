// services/dataCleanupService.ts
import { AzureOpenAI } from "openai";
import {
  AZURE_OPENAI_KEY,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_API_VERSION,
} from "../config/env";

import { dmsPrisma, entitiesPrisma } from "../config/db";

// === TYPES ===
export type CleanResult = {
  original: Record<string, any>;
  cleaned: Record<string, any>;
  changes: Record<string, string>;
  needsReview: boolean;
};

type DatabaseName = "dms" | "entities";

type PossiblePrismaClient = typeof dmsPrisma | typeof entitiesPrisma;

const client = new AzureOpenAI({
  apiKey: AZURE_OPENAI_KEY,
  apiVersion: AZURE_OPENAI_API_VERSION,
});

// === SERVICE CLASS ===
export class DataCleanupService {
  private prismaClients: Record<DatabaseName, PossiblePrismaClient> = {
    dms: dmsPrisma,
    entities: entitiesPrisma,
  };

  /**
   * Fetch rows from a specific table in a database
   */
  async fetchRows(
    db: DatabaseName,
    tableName: string,
    where: Record<string, any>,
    limit?: number
  ): Promise<Record<string, any>[]> {
    const prisma = this.prismaClients[db];
    if (!prisma) throw new Error(`Unsupported database: ${db}`);

    const model = this.getModel(prisma, tableName);
    const queryOptions = limit ? { take: limit } : {};

    const rows = await model.findMany({
      where,
      ...queryOptions,
    });

    return rows as Record<string, any>[];
  }

  /**
   * Clean a batch of rows using Azure OpenAI
   */
  async cleanDataBatch(
    rows: Record<string, any>[],
    keyField: string = "id"
  ): Promise<CleanResult[]> {
    if (rows.length === 0) return [];

    const sampleSize = Math.min(5, rows.length);
    const prompt = this.buildPrompt(rows, keyField, sampleSize);

    try {
      console.log("AI is thinking...");
      const response = await client.chat.completions.create({
        model: AZURE_OPENAI_DEPLOYMENT,
        messages: [
          {
            role: "system",
            content:
              "You are an intelligent database cleaner. Analyze and clean data with minimal assumptions. " +
              "Preserve nulls and empty strings unless clearly erroneous. " +
              "Return only valid JSON with 'results' array containing objects with " +
              "'original', 'cleaned', 'changes', and 'needsReview'.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error("Empty response from AI");

      const parsed = JSON.parse(content);
      const results: CleanResult[] = Array.isArray(parsed.results)
        ? parsed.results
        : [];

      // Validate structure
      return results.map((r) => ({
        original: r.original ?? {},
        cleaned: r.cleaned ?? {},
        changes: r.changes ?? {},
        needsReview: Boolean(r.needsReview),
      }));
    } catch (error) {
      console.error("Auto-clean failed:", error);
      return this.fallbackCleanResults(rows);
    }
  }

  /**
   * Generate safe SQL UPDATE statements (for logging or dry-run)
   */
  generateUpdateSQL(
    tableName: string,
    keyField: string,
    results: CleanResult[]
  ): string {
    const safeUpdates = results.filter(
      (r) => !r.needsReview && Object.keys(r.changes).length > 0
    );

    const updates = safeUpdates.map((r) => {
      const setClauses = Object.entries(r.cleaned)
        .filter(([field]) => field in r.changes)
        .map(
          ([field, value]) => `\`${field}\` = ${this.escapeValueForSQL(value)}`
        )
        .join(",\n  ");

      const keyId = r.original[keyField];
      return `UPDATE \`${tableName}\`\nSET\n  ${setClauses}\nWHERE \`${keyField}\` = ${this.escapeValueForSQL(
        keyId
      )};`;
    });

    return [
      `-- AUTO-CLEAN REPORT (${new Date().toISOString()})`,
      `-- Database Table: ${tableName}`,
      `-- Rows Processed: ${results.length}`,
      `-- Safe Updates: ${updates.length}`,
      `-- Requires Review: ${results.filter((r) => r.needsReview).length}\n`,
      ...updates,
      "",
      updates.length > 0
        ? "-- ⚠️  EXECUTE WITH CAUTION! Review changes before applying."
        : "-- No automatic updates recommended.",
    ].join("\n");
  }

  /**
   * Apply cleaned data directly to the database (use with caution!)
   */
  async applyCleanup(
    db: DatabaseName,
    tableName: string,
    results: CleanResult[],
    keyField: string = "id"
  ): Promise<{ updatedCount: number; errors: string[] }> {
    const prisma = this.prismaClients[db];
    const model = this.getModel(prisma, tableName);
    const errors: string[] = [];
    let updatedCount = 0;

    for (const result of results) {
      if (result.needsReview || Object.keys(result.changes).length === 0) {
        continue;
      }

      try {
        await model.update({
          where: { [keyField]: result.original[keyField] },
          data: result.cleaned,
        });
        updatedCount++;
      } catch (err) {
        errors.push(
          `Failed to update ${tableName}.${keyField}=${
            result.original[keyField]
          }: ${(err as Error).message}`
        );
      }
    }

    return { updatedCount, errors };
  }

  // === PRIVATE HELPERS ===

  private buildPrompt(
    rows: Record<string, any>[],
    keyField: string,
    sampleSize: number
  ): string {
    return `
Analyze and clean the following database records. Follow these rules:
- Standardize formats: dates (ISO), emails (lowercase, valid), phones (E.164), names (trimmed, capitalized).
- Fix obvious typos (e.g., 'Jhon' → 'John', 'gnail.con' → 'gmail.com').
- Preserve NULL, undefined, or empty values if they appear intentional.
- Do not invent missing data.
- Return a JSON object with a 'results' array. Each item must include:
  - "original": original row
  - "cleaned": corrected values
  - "changes": explanation of each change (field → reason)
  - "needsReview": true only if ambiguous or high-risk

Key field: "${keyField}"
Total rows: ${rows.length}
Sample data (${sampleSize} shown):

${JSON.stringify(rows.slice(0, sampleSize), null, 2)}

Return only JSON. No additional text.
    `.trim();
  }

  private fallbackCleanResults(rows: Record<string, any>[]): CleanResult[] {
    return rows.map((row) => ({
      original: row,
      cleaned: row,
      changes: {},
      needsReview: true,
    }));
  }

  private escapeValueForSQL(value: any): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "string") {
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value.toString();
    }
    if (typeof value === "object") {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private getModel(prisma: PossiblePrismaClient, tableName: string): any {
    const model = (prisma as any)[tableName];
    if (!model) {
      throw new Error(
        `Model for table "${tableName}" not found in Prisma client.`
      );
    }
    return model;
  }
}
