// services/AIPropertyMergerService.ts
import { AzureOpenAI } from "openai";
import { entity_property } from "../../generated/client/entities_prod";
import {
    AZURE_OPENAI_API_VERSION,
    AZURE_OPENAI_DEPLOYMENT,
    AZURE_OPENAI_KEY,
    AZURE_OPENAI_ENDPOINT,
} from "../config/env";

export type PropertyRecord = entity_property

interface AIPropertyMergeOutput {
    unique_properties: Array<{
        property_id: string;
        property_value: string;
        property_title?: string | null;
        is_primary?: "Yes" | "No";
    }>;
    reasoning: string;
}

export class AIPropertyMergerService {
    private openai: AzureOpenAI;
    private readonly MAX_TOKENS = 800;
    private readonly TEMPERATURE = 0.1;

    constructor() {
        this.openai = new AzureOpenAI({
            apiKey: AZURE_OPENAI_KEY,
            apiVersion: AZURE_OPENAI_API_VERSION,
            endpoint: AZURE_OPENAI_ENDPOINT,
        });
    }

    /**
     * Main method: deduplicate and merge properties using AI
     */
    async merge(properties: PropertyRecord[]): Promise<PropertyRecord[]> {
        if (properties.length <= 1) return properties;

        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(properties);

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

            const content = response.choices[0]?.message?.content?.trim();
            if (!content) throw new Error("Empty response from AI");

            let parsed: AIPropertyMergeOutput;
            try {
                parsed = JSON.parse(content);
            } catch (err) {
                console.error("AI Property Merger - Failed to parse JSON:", content);
                throw new Error("AI returned invalid JSON");
            }

            if (!Array.isArray(parsed.unique_properties)) {
                throw new Error("AI response missing or invalid 'unique_properties'");
            }

            // Map back to Prisma-compatible entity_property objects
            return parsed.unique_properties.map((prop) => ({
                entity_property_id: 0, // will be set on save
                entity_id: 0, // set later
                property_id: prop.property_id,
                property_value: prop.property_value,
                property_title: prop.property_title ?? null,
                is_primary: prop.is_primary ?? "No",
                created_by: null,
                updated_by: null,
                created_at: new Date(),
                updated_at: new Date(),
                parent_id: null,
                property_refid: null,
                position: null
            }));
        } catch (error: any) {
            console.error("AI Property Merging Failed:", error.message);
            throw error;
        }
    }

    /**
     * System prompt: defines AI behavior
     */
    private buildSystemPrompt(): string {
        return `
You are an intelligent property deduplication assistant for CRM data.

### Task
Analyze a list of contact properties (emails, phone numbers, etc.) and return only the unique, standardized ones.

### Rules
1. Determine duplicates **by property_id and normalized property_value ONLY**:
   - Ignore differences in property_title, is_primary, or other metadata.
   - If two entries have the same property_id and semantically equivalent property_value, treat them as duplicates.
   
2. Normalization rules:
   - **Emails**: 
     - Case-insensitive.
     - For Gmail (@gmail.com): ignore dots in the local part (e.g., john.smith@gmail.com = johnsmith@gmail.com).
     - Trim whitespace.
   - **Phone numbers**:
     - Extract digits only (remove +, -, (, ), spaces).
     - Match if digit sequences are identical (e.g., +27 123... = 012 345... if digits match).
     - Standardize to E.164-like format: +CC XXX XXX-XXXX (e.g., +27 123 456-7890).

3. Merging:
   - Keep only one entry per unique (property_id + normalized value).
   - If any duplicate has is_primary = "Yes", the merged entry must have is_primary = "Yes".
   - Use the most complete or meaningful property_title (e.g., "Work Email" over "Email").

4. Output:
   - Return ONLY valid JSON with:
     - "unique_properties": [ { property_id, property_value, property_title?, is_primary? } ]
     - "reasoning": string (brief summary of merges and standardizations)
   - Never invent values — only use provided data.
   - Do not include any text outside the JSON object.

Return only JSON. No extra explanation.
`;
    }

    /**
     * User prompt: provides actual data
     */
    private buildUserPrompt(properties: PropertyRecord[]): string {
        const formatProp = (p: PropertyRecord, index: number) => `
Property ${index + 1}:
- property_id: "${p.property_id}"
- property_value: "${p.property_value?.trim().replace(/"/g, '\\"').replace(/\n/g, ' ')}"  // Escape quotes and newlines
- property_title: "${p.property_title?.trim().replace(/"/g, '\\"') || 'N/A'}"
- is_primary: "${p.is_primary === 'Yes' ? 'Yes' : 'No'}"
`.trim();

        const propertiesStr = properties.map(formatProp).join('\n\n');

        return `
Analyze the following list of contact properties and identify duplicates based **only** on the combination of:
- property_id (e.g., "email", "phone_number")
- semantically equivalent property_value (after normalization)

### Deduplication Rules:
1. **Ignore metadata differences**:
   - Do NOT treat entries as unique just because property_title or is_primary differ.
   - Example: "Work Email" vs "Personal" for the same email → still a duplicate.
2. Normalize values before comparison:
   - Emails: lowercase, trim, and for @gmail.com — ignore dots in the local part.
   - Phone numbers: extract digits only, then compare. If digit sequences match, they are duplicates.
3. For merged entries:
   - Use the most meaningful property_title (prefer "Work" over "N/A").
   - If any duplicate has is_primary = "Yes", the result must have is_primary = "Yes".

${propertiesStr}

### Output Format
Return a JSON object with:
- "unique_properties": List of deduplicated, standardized properties.
- "reasoning": Brief explanation of how many were merged, and key decisions.

{
  "unique_properties": [
    {
      "property_id": "email",
      "property_value": "john.doe@example.com",
      "property_title": "Work Email",
      "is_primary": "Yes"
    },
    {
      "property_id": "phone_number",
      "property_value": "+27 123 456-7890",
      "property_title": "Mobile",
      "is_primary": "No"
    }
  ],
  "reasoning": "Merged 3 properties into 2 unique entries. Combined two emails with identical addresses but different titles. Standardized two phone numbers with matching digits into +27 format. Preserved primary status where applicable."
}
`;
    }
}