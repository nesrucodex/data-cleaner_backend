import { AzureOpenAI } from "openai";
import {
  address,
  entity,
  entity_property,
  people,
} from "../../generated/client/entities_prod";
import {
  AZURE_OPENAI_API_VERSION,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_KEY,
} from "../config/env";

// === Types ===
export type PeopleRecord = people & {
  entity: entity & {
    address: address[];
    entity_property_entity_property_entity_idToentity: entity_property[];
  };
};

export type UserMergeInput = {
  primary: PeopleRecord;
  duplicates: PeopleRecord[];
};

export type UserMergeOutput = {
  keep: string; // people_id as string
  remove: string[];
  needsReview?: boolean;
  suggestions?: string;
  changes?: Record<string, string>;
};

/**
 * AI Service to decide which person record to keep during deduplication.
 * AI returns only the decision — backend handles the actual merge.
 */
export class UserMergeAIService {
  private openai: AzureOpenAI;
  private readonly MAX_TOKENS = 1500;
  private readonly TEMPERATURE = 0.2;

  constructor() {
    this.openai = new AzureOpenAI({
      apiKey: AZURE_OPENAI_KEY,
      apiVersion: AZURE_OPENAI_API_VERSION,
    });
  }

  async call(input: UserMergeInput): Promise<UserMergeOutput> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);

    try {
      const response = await this.openai.chat.completions.create({
        model: AZURE_OPENAI_DEPLOYMENT,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: this.TEMPERATURE,
        max_tokens: this.MAX_TOKENS,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Empty response from AI");

      const parsed = JSON.parse(content) as UserMergeOutput;

      if (typeof parsed.keep !== "string" || !Array.isArray(parsed.remove)) {
        throw new Error("Invalid AI response structure");
      }

      return parsed;
    } catch (error: any) {
      console.error("AI Merge Service Error:", error);
      throw new Error(error.message || "I Merge Service Falied, try again.");
    }
  }

  private buildSystemPrompt(): string {
    return `
You are an intelligent data deduplication assistant.
Analyze multiple user records with the same name and decide which one to keep and which to remove.

Rules:
- Choose ONE record to "keep" — prefer the one with:
  - Primary email or phone (is_primary = "Yes")
  - More complete data
  - Earlier creation date (if unsure)
- List all others in "remove"
- If both have primary contacts or data conflicts, set "needsReview": true
- DO NOT fabricate data. Only use what's provided.
- If property values have similar value for propery_id, just keep one propery value and remove the other 

Return ONLY JSON with this structure:
{
  "keep": "51169",
  "remove": ["60015"],
  "needsReview": false,
  "suggestions": "Kept record with primary email.",
  "changes": {
    "email": "Explain what happened",
    "Other_propery: "Explain what happened",
  }
}
`;
  }

  private buildUserPrompt(input: UserMergeInput): string {
    const formatProp = (prop: entity_property) =>
      prop.property_value
        ? `${prop.property_id}="${prop.property_value}" [primary=${prop.is_primary}]`
        : null;

    const formatEntity = (user: PeopleRecord) => {
      const props =
        user.entity.entity_property_entity_property_entity_idToentity
          .map(formatProp)
          .filter(Boolean)
          .map((line) => `      - ${line}`)
          .join("\n");

      return `
    Name: ${user.entity.name ?? "N/A"}
    First: ${user.first_name ?? "N/A"} | Last: ${user.last_name ?? "N/A"}
    People ID: ${user.people_id}
    Entity ID: ${user.entity.entity_id}
    Created At: ${user.created_at}
    Properties:
${props || "      - (none)"}`;
    };

    return `
Analyze these user records and determine merge strategy.

Primary Candidate:
${formatEntity(input.primary)}

Duplicates:
${input.duplicates
  .map((dup, i) => `  Duplicate ${i + 1}:\n${formatEntity(dup)}`)
  .join("\n\n")}

Apply logic and return JSON as specified.
`;
  }
}
