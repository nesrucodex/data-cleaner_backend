// services/entityMergeAI.service.ts

import { AzureOpenAI } from "openai";
import {
  entity,
  people,
  address,
  entity_property,
} from "../../generated/client/entities_prod";
import {
  AZURE_OPENAI_API_VERSION,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_KEY,
  AZURE_OPENAI_ENDPOINT, // Make sure this is defined in env
} from "../config/env";

// === Types ===
export type EntityRecord = entity & {
  people: people[];
  address: address[];
  entity_property_entity_property_entity_idToentity: entity_property[];
};

export type EntityMergeInput = {
  primary: EntityRecord;
  duplicates: EntityRecord[];
};

export type EntityMergeOutput = {
  keep: string;
  remove: string[];
  needsReview?: boolean;
  suggestions?: string;
  changes?: Record<string, string>;
};

/**
 * AI Service to decide which entity to keep during deduplication.
 * Does NOT perform merge — only returns decision.
 */
export class EntityMergeAIService {
  private openai: AzureOpenAI;
  private readonly MAX_TOKENS = 1000;
  private readonly TEMPERATURE = 0.1;

  constructor() {
    this.openai = new AzureOpenAI({
      apiKey: AZURE_OPENAI_KEY,
      apiVersion: AZURE_OPENAI_API_VERSION,
    //   endpoint: AZURE_OPENAI_ENDPOINT, // e.g., "https://your-resource.openai.azure.com"
    });
  }

  async call(input: EntityMergeInput): Promise<EntityMergeOutput> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);

    console.log("AI thinking...")

    try {
      const response = await this.openai.chat.completions.create({
        model: AZURE_OPENAI_DEPLOYMENT, // e.g., "gpt-4o-mini"
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: this.TEMPERATURE,
        max_tokens: this.MAX_TOKENS,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("Empty or undefined response from AI");
      }

      let parsed: EntityMergeOutput;
      try {
        parsed = JSON.parse(content);
      } catch (jsonError) {
        console.error("AI Response (Invalid JSON):", content);
        throw new Error("AI returned malformed JSON. Failed to parse.");
      }

      // Validate required fields
      if (typeof parsed.keep !== "string") {
        throw new Error("AI response missing 'keep' field or not a string");
      }
      if (!Array.isArray(parsed.remove)) {
        throw new Error("AI response missing 'remove' field or not an array");
      }
      parsed.remove = parsed.remove.map((id) => String(id)); // ensure strings

      return parsed;
    } catch (error: any) {
      console.error("AI Merge Service Error:", {
        message: error.message,
        stack: error.stack,
      });
      throw new Error(`Entity deduplication AI failed: ${error.message}`);
    }
  }

  /**
   * Normalize phone number by removing all non-digit characters
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, "");
  }

  /**
   * Split full name into first and last name
   */
  private splitFullName(fullName: string): {
    firstName: string;
    lastName: string;
  } {
    const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: "", lastName: "" };
    if (parts.length === 1) return { firstName: parts[0], lastName: "" };
    return {
      firstName: parts.slice(0, -1).join(" "),
      lastName: parts[parts.length - 1],
    };
  }

  /**
   * Build system prompt to guide AI decision-making
   */
  private buildSystemPrompt(): string {
    return `
You are a data quality AI for deduplicating entity records.

### Goal
Analyze multiple records with the same name and decide:
- Which ONE entity to "keep"
- Which to "remove"
- Whether "needsReview" is needed

### Rules
1. Choose "keep" based on:
   - Has primary email or phone (is_primary="Yes")
   - Has split first_name and last_name (better than full name in first_name)
   - More complete data (title, industry, etc.)
   - Created earlier if tied

2. If two records have different primary emails or phones, set "needsReview": true.

3. DO NOT merge data — only decide which to keep/remove.

4. Return ONLY JSON with this structure:
{
  "keep": "83247",
  "remove": ["82563", "151489"],
  "needsReview": false,
  "suggestions": "Kept record with split name and primary email.",
  "changes": {
    "name": "Name was split in kept record",
    "phone": "Multiple formats found, all refer to same number"
  }
}

5. Treat these as same:
   - first_name="Musa Mhlanga", last_name="" ≈ first_name="Musa", last_name="Mhlanga"
   - +27840586022 ≈ +27 840 586-022

6. Return nothing except valid JSON.
`;
  }

  /**
   * Build user prompt with clean, normalized data
   */
  private buildUserPrompt(input: EntityMergeInput): string {
    const { primary, duplicates } = input;

    // Helper: format person with name normalization
    const formatPerson = (p: people): string => {
      const fullName =
        [p.first_name, p.last_name].filter(Boolean).join(" ") ||
        p.first_name ||
        "";
      const { firstName, lastName } = this.splitFullName(fullName);
      const displayName = lastName ? `${firstName} ${lastName}` : firstName;
      const title = p.title ? p.title : "";
      return displayName + title;
    };

    // Helper: normalize property value for comparison
    const normalizeProp = (prop: entity_property): string => {
      if (!prop.property_value) return "";
      if (prop.property_id === "phone_number") {
        return this.normalizePhone(prop.property_value);
      }
      if (prop.property_id === "email") {
        return prop.property_value.trim().toLowerCase();
      }
      return prop.property_value.trim();
    };

    // Helper: summarize an entity
    const summarize = (e: EntityRecord, label: string): string => {
      const peopleStr = e.people.map(formatPerson).join("; ");
      const props =
        e.entity_property_entity_property_entity_idToentity
          .filter((p) => p.property_value)
          .map((p) => {
            const normalized = normalizeProp(p);
            return `${p.property_id}="${normalized}" [primary=${p.is_primary}]`;
          })
          .join(", ") || "none";

      const addressCount = e.address.filter((a) => a.line_one).length;

      return `
- ${label}
  Entity ID: ${e.entity_id}
  Name: ${e.name}
  Person(s): ${peopleStr}
  Properties: ${props}
  Addresses: ${addressCount} found
  Created: ${JSON.stringify(e.created_at)}
`;
    };

    // Build full prompt
    const primaryStr = summarize(primary, "Primary Candidate");
    const duplicatesStr = duplicates
      .map((dup, i) => summarize(dup, `Duplicate ${i + 1}`))
      .join("\n");

    return `
Analyze these records and return JSON with "keep", "remove", and optional "needsReview".

${primaryStr}

Duplicates:
${duplicatesStr}

Rules:
- Choose ONE to keep.
- If primary email/phone conflict, set "needsReview": true.
- Do not invent data.
- Return ONLY JSON as specified.
`;
  }
}
