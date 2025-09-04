import { AzureOpenAI } from "openai";
import { address } from "../../generated/client/entities_prod";
import {
  AZURE_OPENAI_API_VERSION,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_KEY,
  AZURE_OPENAI_ENDPOINT,
} from "../config/env";

export type AddressRecord = address;

interface AIDeduplicateAddressesOutput {
  unique_addresses: Array<address>;
  reasoning: string;
}

export class AIAddressDeduplicatorService {
  private openai: AzureOpenAI;
  private readonly MAX_TOKENS = 1000;
  private readonly TEMPERATURE = 0.1;

  constructor() {
    this.openai = new AzureOpenAI({
      apiKey: AZURE_OPENAI_KEY,
      apiVersion: AZURE_OPENAI_API_VERSION,
      endpoint: AZURE_OPENAI_ENDPOINT,
    });
  }

  async deduplicate(addresses: AddressRecord[]): Promise<AddressRecord[]> {
    if (addresses.length <= 1) return addresses;

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(addresses);

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

      let parsed: AIDeduplicateAddressesOutput;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        console.error(
          "AI Address Deduplicator - Failed to parse JSON:",
          content
        );
        throw new Error("AI returned invalid JSON");
      }

      if (!Array.isArray(parsed.unique_addresses)) {
        throw new Error("AI response missing or invalid 'unique_addresses'");
      }

      // Convert back to Prisma-compatible address objects
      return parsed.unique_addresses.map((addr, index) => ({
        ...addr,
        address_id: addr.address_id ?? null,
        // entity_id: null, // will be set later
        line_one: addr.line_one,
        line_two: addr.line_two,
        city: addr.city,
        state: addr.state,
        zipcode: addr.zipcode,
        country: addr.country,
        created_by: null,
        updated_by: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      }));
    } catch (error: any) {
      console.error("AI Address Deduplication Failed:", error.message);
      throw error;
    }
  }

  private buildSystemPrompt(): string {
    return `
You are an intelligent address deduplication assistant.

### Task
Analyze a list of addresses and return only the unique ones.
Treat semantically equivalent addresses as duplicates, even with:
- Different abbreviations (St. = Street, Ave = Avenue)
- Typos or spacing differences
- Missing secondary lines
- Case variations

### Rules
1. If two addresses refer to the same physical location, keep only one.
2. Standardize formatting (e.g., "St" → "Street" if known).
3. Never invent values — only use provided data.
4. Return ONLY JSON with:
   - "unique_addresses": [ { address_id, line_one, line_two, city, state, zipcode, country } ]
   - "reasoning": string

Return valid JSON only. No extra text.
`;
  }

  private buildUserPrompt(addresses: AddressRecord[]): string {
    const formatAddr = (a: AddressRecord, index: number) =>
      `
Address ${index + 1}:
- address_id: ${a.address_id}
- line_one: "${a.line_one}"
- line_two: "${a.line_two}"
- city: "${a.city}"
- state: "${a.state}"
- zipcode: "${a.zipcode}"
- country: "${a.country}"
`.trim();

    const addressesStr = addresses.map(formatAddr).join("\n\n");

    return `
Analyze these addresses and return deduplicated list.

${addressesStr}

Return JSON:
{
  "unique_addresses": [
    {
      "address_id": 123,
      "line_one": "123 Main St",
      "line_two": "Unit A",
      "city": "Johannesburg",
      "state": "Gauteng",
      "zipcode": "2000",
      "country": "ZA",
    }
  ],
  "reasoning": "Merged 4 addresses into 2 unique locations..."
}
`;
  }
}
