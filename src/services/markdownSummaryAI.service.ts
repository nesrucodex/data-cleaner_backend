import { AzureOpenAI } from "openai";
import {
    AZURE_OPENAI_API_VERSION,
    AZURE_OPENAI_DEPLOYMENT,
    AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_KEY,
} from "../config/env";

export type QueryResultSummaryInput = {
    question: string;
    sql: string;
    results: any[];
    errorFeedback?: Array<{ sql: string; error: string }>;
    dataSource?: "entities" | "dms";
};

export class MarkdownSummaryAIService {
    private openai: AzureOpenAI;

    constructor() {
        this.openai = new AzureOpenAI({
            apiKey: AZURE_OPENAI_KEY,
            apiVersion: AZURE_OPENAI_API_VERSION,
            deployment: AZURE_OPENAI_DEPLOYMENT,
            endpoint: AZURE_OPENAI_ENDPOINT || "",
        });
    }

    async generateSummary(input: QueryResultSummaryInput): Promise<string> {
        const { question, sql, results, errorFeedback = [], dataSource } = input;

        const systemPrompt = `
You are a friendly, articulate AI Data Assistant. Your job is to turn database query results into clear, engaging, well-formatted Markdown for business users.

## 📝 RULES

- Use headers, bullet points, tables, bold, and emojis to make output readable.
- NEVER show raw SQL unless user explicitly asked for it.
- If results are empty → explain politely and suggest alternatives.
- If errors occurred → summarize what went wrong and how to fix it.
- Mention data source if relevant (e.g., “from DMS tickets system”).
- Keep it concise — 1 to 3 paragraphs max, plus optional table.
- Always start with a direct answer to the user’s question.
- Use business-friendly tone — no jargon unless necessary.

## 🧾 OUTPUT FORMAT

Return ONLY valid Markdown. No JSON. No extra text.

## 💡 EXAMPLE 1: Success

User: “Show me Acme Inc’s bank accounts”

→

## 💰 Bank Accounts for Acme Inc

Found 2 active accounts:

| IBAN | Currency | Bank         | Status  |
|------|----------|--------------|---------|
| DE89... | EUR      | Deutsche Bank | ✅ Valid |
| GB29... | GBP      | HSBC UK       | ✅ Valid |

> ℹ️ Sourced from Entities DB. Last updated 2025-04-01.

## 💡 EXAMPLE 2: No Results

→

> 🔍 Sorry, I couldn’t find any bank accounts for “XYZ Corp”.  
> → Try checking the spelling or ask for “all accounts with partial name XYZ”.

## 💡 EXAMPLE 3: After Errors

→

> ⚠️ I had some trouble fetching your data due to invalid column references.  
> I retried twice and adjusted the query — here’s what I found:

## 📋 Matching Tickets

| Ticket ID | Subject          | Assigned To |
|-----------|------------------|-------------|
| TK218552  | Payment Delay    | John Smith  |

> 💡 Tip: Avoid ambiguous terms like “recent” — try “last 7 days” instead.

## 🚀 BEGIN
`.trim();

        // Preview first 5 rows to avoid token overload
        const resultsPreview = JSON.stringify(results.slice(0, 5), null, 2);
        const errorLog = errorFeedback.length > 0
            ? `\n\n### ⚠️ Query Issues Encountered\n${errorFeedback.map((e, i) => `${i + 1}. \`${e.error}\``).join('\n')}`
            : '';

        const dataSourceNote = dataSource ? `\n> 🗃️ *Data source: ${dataSource === "entities" ? "Entities Master DB" : "Deal Management System (DMS)"}*` : '';

        const userPrompt = `
**User Question**: "${question}"

**Executed Query**:
\`\`\`sql
${sql}
\`\`\`

**Results** (${results.length} rows returned):
\`\`\`json
${resultsPreview}
\`\`\`
${errorLog}
${dataSourceNote}
`.trim();

        try {
            const response = await this.openai.chat.completions.create({
                model: AZURE_OPENAI_DEPLOYMENT,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                temperature: 0.3,
                max_tokens: 1000,
                top_p: 0.95,
            });

            let markdown = response.choices[0]?.message?.content?.trim() || "";

            // Fallbacks
            if (!markdown) {
                if (results.length === 0) {
                    markdown = `> 🔍 No results found for: _"${question}"_. Try rephrasing, checking spelling, or broadening your filters.`;
                } else {
                    markdown = `✅ Found ${results.length} result(s) for: _"${question}"_.${dataSourceNote}`;
                }
            }

            return markdown;
        } catch (error) {
            console.error("MarkdownSummaryAIService.generateSummary failed:", error);

            // Final fallback
            if (results.length === 0) {
                return `> ❌ Sorry, I couldn't find anything matching _"${question}"_. Try asking differently.`;
            }
            return `✅ I found ${results.length} result(s) for your question. [AI summary temporarily unavailable]${dataSourceNote}`;
        }
    }
}