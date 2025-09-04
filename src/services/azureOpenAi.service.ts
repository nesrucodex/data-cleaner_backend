import { AzureOpenAI } from "openai";
import {
  AZURE_OPENAI_KEY,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_API_VERSION,
} from "../config/env";
import { dmsPrisma, entitiesPrisma } from "../config/db";
import logger from "../libs/logger";

// === TYPES ===
export type CleanResult = {
  original: Record<string, any>;
  cleaned: Record<string, any>;
  changes: Record<string, string>;
  needsReview: boolean;
  isFailed: boolean;
  suggestions?: string;
};

type TableRow = Record<string, any>;

type DatabaseName = "dms" | "entities";
type PossiblePrismaClient = typeof dmsPrisma | typeof entitiesPrisma;

// === CONFIGURATION ===
const CONFIG = {
  // BATCH_SIZE: 3,
  MAX_CONCURRENT_REQUESTS: 3,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_BASE: 1000, // Exponential backoff base (ms)
  TIMEOUT_MS: 30_000,
  MAX_BYTES_PER_CHUNK: 3_000,
};

// === OPENAI CLIENT ===
const openai = new AzureOpenAI({
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
   * Calculates how many chunks are needed to stay within a byte size limit per request.
   * Useful for sending large row data to an external API that expects small payloads.
   */
  calculateChunkCount(rows: TableRow[]): number {
    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const jsonSizeInBytes = Buffer.byteLength(JSON.stringify(rows), "utf8");

    const chunkCount = Math.ceil(jsonSizeInBytes / CONFIG.MAX_BYTES_PER_CHUNK);

    return Math.max(1, chunkCount);
  }

  async cleanDataBatch(
    rows: Record<string, any>[],
    keyField: string = "id"
  ): Promise<CleanResult[]> {
    if (rows.length === 0) return [];

    const batchSize = Math.ceil(rows.length / this.calculateChunkCount(rows));

    console.log({ batchSize });

    const batches = this.chunk(rows, batchSize);
    console.log(`Split ${rows.length} rows into ${batches.length} batches`);

    // TODO: Remove below code, It's just for testing purpose
    const suggestedKeyField = await this.suggestKeyFieldFromRow(rows[0]);

    console.log({ suggestedKeyField });

    const results: CleanResult[] = [];
    const concurrencyLimit = CONFIG.MAX_CONCURRENT_REQUESTS;

    // Manual concurrency control (like p-limit)
    const executing: Promise<void>[] = [];
    let batchIndex = 0;

    while (batchIndex < batches.length) {
      // Fill up to concurrency limit
      while (
        executing.length < concurrencyLimit &&
        batchIndex < batches.length
      ) {
        const batch = batches[batchIndex];
        const index = batchIndex;

        const promise = (async () => {
          try {
            const cleaned = await this.processBatchWithRetry(
              batch,
              keyField,
              index + 1
            );
            results.push(...cleaned);
            console.log(`✅ Batch ${index + 1} processed`);
          } catch (error) {
            logger.error(`❌ Batch ${index + 1} failed permanently`, {
              error: (error as Error).message,
            });
            // Fallback on permanent failure
            results.push(...this.fallbackBatch(batch));
          }
        })();

        executing.push(promise);
        batchIndex++;

        // Remove from executing list when done
        promise.then(
          () => executing.splice(executing.indexOf(promise), 1),
          () => executing.splice(executing.indexOf(promise), 1)
        );
      }

      // Wait for at least one batch to finish before queuing more
      if (executing.length >= concurrencyLimit) {
        await Promise.race(executing);
      }
    }

    // Wait for all remaining
    await Promise.allSettled(executing);

    console.log(`Completed cleaning ${results.length} rows`);
    return results;
  }

  async applyCleanup(
    db: DatabaseName,
    tableName: string,
    results: CleanResult[],
    keyField?: string
  ): Promise<{ updatedCount: number; errors: string[] }> {
    const prisma = this.prismaClients[db];
    const model = this.getModel(prisma, tableName);
    const errors: string[] = [];
    let updatedCount = 0;

    const safeResults = results.filter(
      (r) => !r.needsReview && Object.keys(r.changes).length > 0
    );

    logger.info(`Applying cleanup to ${safeResults.length} safe records`);

    const concurrencyLimit = CONFIG.MAX_CONCURRENT_REQUESTS;
    const executing: Promise<void>[] = [];
    let index = 0;

    const suggestedKeyField = await this.suggestKeyFieldFromRow(
      safeResults[0].original
    );

    const kf = keyField || suggestedKeyField;

    if (!kf) {
      throw new Error("KeyField not found to update the table.");
    }

    while (index < safeResults.length) {
      while (
        executing.length < concurrencyLimit &&
        index < safeResults.length
      ) {
        const result = safeResults[index];

        const promise = (async () => {
          try {
            await model.update({
              where: { [kf]: result.original[kf] },
              data: result.cleaned,
            });
            updatedCount++;
          } catch (err) {
            errors.push(
              `Update failed for ${kf}=${result.original[kf]}: ${
                (err as Error).message
              }`
            );
          }
        })();

        executing.push(promise);
        index++;

        promise.then(
          () => executing.splice(executing.indexOf(promise), 1),
          () => executing.splice(executing.indexOf(promise), 1)
        );
      }

      if (executing.length >= concurrencyLimit) {
        await Promise.race(executing);
      }
    }

    await Promise.allSettled(executing);
    return { updatedCount, errors };
  }

  // --- Private Helpers ---

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private async processBatchWithRetry(
    batch: Record<string, any>[],
    keyField: string,
    batchNumber: number
  ): Promise<CleanResult[]> {
    const MAX_RETRIES = CONFIG.RETRY_ATTEMPTS;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.callAIWithTimeout(batch, keyField);
        console.log(`Batch ${batchNumber} succeeded on attempt ${attempt + 1}`);
        return result;
      } catch (error: any) {
        lastError = error;
        if (attempt < MAX_RETRIES - 1) {
          const delay = CONFIG.RETRY_DELAY_BASE * Math.pow(2, attempt); // exponential
          console.warn(
            `Attempt ${attempt + 1} failed for batch ${batchNumber}: ${
              error.message
            }. Retrying in ${delay}ms...`
          );
          await this.delay(delay);
        }
      }
    }

    logger.error(`Batch ${batchNumber} failed after ${MAX_RETRIES} attempts`, {
      error: lastError?.message,
    });
    return this.fallbackBatch(batch);
  }

  private async callAIWithTimeout(
    batch: Record<string, any>[],
    keyField: string
  ): Promise<CleanResult[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

    try {
      const prompt = this.buildPrompt(batch, keyField);
      console.log(`Sending batch of ${batch.length} rows to AI...`);

      const response = await openai.chat.completions.create(
        {
          model: AZURE_OPENAI_DEPLOYMENT,
          messages: [
            {
              role: "system",
              content:
                "You are a precise database cleaner. Return only JSON with 'results' array. " +
                "Preserve nulls. Return 'needsReview' for ambiguity.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
          max_tokens: 2000,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error("Empty AI response");

      const parsed = JSON.parse(content);
      return (parsed.results || []).map((r: any) => ({
        // original: r.original ?? {},
        cleaned: r.cleaned ?? {},
        changes: r.changes ?? {},
        needsReview: Boolean(r.needsReview),
        suggestions: r.suggestions,
        isFailed: false,
      }));
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw new Error("AI request timed out");
      }
      throw error;
    }
  }

  private buildPrompt(rows: Record<string, any>[], keyField: string): string {
    return `
Analyze and clean the following ${
      rows.length
    } database records. Follow these rules:

### 📏 Rules
- Standardize formats:
  - Dates → ISO format (YYYY-MM-DD or ISO 8601)
  - Emails → lowercase, valid format (e.g., user@domain.com)
  - Phones → E.164 format (e.g., +1234567890)
  - Names → Trimmed, capitalized (e.g., "john" → "John")
- Fix obvious typos (e.g., "Jhon" → "John", "gnail.con" → "gmail.com")
- Preserve NULL, undefined, or empty strings if they seem intentional.
- Do NOT invent missing data (e.g., don’t guess an email).
- If a value is ambiguous or high-risk to change, mark it for review **with a clear suggestion**.

### 🧩 Output Format
Return a JSON object with a "results" array. Each item must include:
{
  "cleaned": { ... },            // Corrected values (same structure)
  "changes": { "field": "reason" }, // e.g., "email": "Corrected domain typo"
  "needsReview": true/false,     // True if uncertain
  "suggestions": "Optional explanation if needsReview is true"
}

### 🔑 Key Field
"${keyField}"

### 📄 Sample Data (${rows.length} record(s)):
${JSON.stringify(rows, null, 2)}

### 📝 Instructions
- Return ONLY JSON. No additional text.
- If no changes are needed, return empty "changes" object.
- Always include "suggestions" if "needsReview" is true. Example:
  "suggestions": "Phone number is missing country code; suggest verifying format."
  "suggestions": "Email domain 'yaho.com' might be 'yahoo.com'; recommend confirmation."
`.trim();
  }
  private fallbackBatch(batch: Record<string, any>[]): CleanResult[] {
    return batch.map((row) => ({
      original: row,
      cleaned: row,
      changes: {},
      needsReview: true,
      isFailed: true,
    }));
  }

  private getModel(prisma: PossiblePrismaClient, tableName: string) {
    const model = (prisma as any)[tableName];
    if (!model)
      throw new Error(`Model "${tableName}" not found in Prisma client.`);
    return model;
  }

  async suggestKeyFieldFromRow(
    row: Record<string, any>
  ): Promise<string | null> {
    try {
      const prompt = `
You are an expert in databases. Given a single database row (as a JSON object), identify the most appropriate field to use as the primary key for record updates in a Prisma query. Choose a field that is:

- Unique
- Likely to be used in WHERE clause
- Commonly named like: id, uuid, user_id, email, etc.

Return only the field name as a plain string. If you're unsure, return "id" as a default guess.

### Row:
${JSON.stringify(row, null, 2)}

Return only:
"id" or "uuid" or "email" etc. (just the key field name as a string)
`;

      const response = await openai.chat.completions.create({
        model: AZURE_OPENAI_DEPLOYMENT,
        messages: [
          {
            role: "system",
            content:
              "You identify likely primary key fields from a database row.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 10,
      });

      const field = response.choices[0]?.message?.content
        ?.trim()
        .replace(/["']/g, "");
      if (!field || !Object.keys(row).includes(field)) {
        console.warn(
          `AI suggested invalid key field: "${field}". Falling back to "id".`
        );
        return "id";
      }

      return field;
    } catch (error: any) {
      console.error("Failed to get key field from AI:", error.message);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
