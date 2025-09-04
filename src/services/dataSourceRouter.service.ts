// services/DataSourceRouterService.ts
import { AzureOpenAI } from "openai";
import { AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_KEY, AZURE_OPENAI_ENDPOINT } from "../config/env";

export type RoutingDecision = {
  target: "entities" | "dms" | "unknown";
  confidence: 0.1 | 0.5 | 0.9;
  reason: string;
  entities_tables?: string[];
  dms_tables?: string[];
};

/**
 * AI-powered router that decides whether a question should be answered
 * using the entities_prod DB or dms_prod DB.
 */
export class DataSourceRouterService {
  private openai: AzureOpenAI;

  constructor() {
    this.openai = new AzureOpenAI({
      apiKey: AZURE_OPENAI_KEY,
      apiVersion: AZURE_OPENAI_API_VERSION,
      deployment: AZURE_OPENAI_DEPLOYMENT,
      endpoint: AZURE_OPENAI_ENDPOINT || "",
    });
  }

  async routeQuestion(question: string): Promise<RoutingDecision> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = `Analyze this question:\n\n"${question}"\n\nRespond only in JSON.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: AZURE_OPENAI_DEPLOYMENT,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error("Empty AI response");

      const decision: RoutingDecision = JSON.parse(content);
      return decision;
    } catch (error) {
      console.warn("Routing AI failed:", error);
      return {
        target: "unknown",
        confidence: 0.1,
        reason: "Failed to analyze question due to AI error.",
      };
    }
  }

  private buildSystemPrompt(): string {
    return `
You are an expert data routing engine. Your job is to determine whether a natural language question should be answered using the **Entities Database** or the **DMS (Deal Management System) Database**.

## 🧠 Database Context

### 🏢 \`entities_prod\` (Entities DB)
Used for **master data about organizations, people, banking, assets, and risk**.
- Key topics: 
  - Companies, individuals, legal entities
  - Addresses, bank accounts, SWIFT/BIC, IBAN
  - Risk ratings, credit limits, entity roles (debtor, creditor)
  - Dynamic properties (email, phone, website)
- Key tables: 
  - \`entity\`, \`people\`, \`address\`, \`bank_account\`, \`entity_role\`, \`entity_risk_and_rates\`, \`property\`

Use this DB when the question involves:
- "What is the address of X company?"
- "Show me bank accounts for entity 1001"
- "List all creditors"
- "What is the risk rating of Acme Inc?"
- "Find people with email domain @example.com"

### 📂 \`dms_prod\` (DMS DB)
Used for **deal lifecycle, tickets, tasks, notes, leads, and user workflows**.
- Key topics:
  - Tickets (e.g., TK218552), tags, deadlines
  - Leads, opportunities, transactions
  - Notes, schedules, reminders
  - Users, assignments, statuses
- Key tables:
  - \`leads_tickets\`, \`leads_notes\`, \`leads_transactions\`, \`users\`, \`leads_tags\`, \`reminders\`

Use this DB when the question involves:
- "What is the status of ticket TK218552?"
- "Show me notes on deal X"
- "Who is assigned to ticket 5001?"
- "List all overdue tasks"
- "Show me leads owned by John"

## 🎯 Your Task
Analyze the input question and return a JSON object with:
- \`target\`: "entities" | "dms" | "unknown"
- \`confidence\`: 0.9 (clear), 0.5 (ambiguous), 0.1 (guess)
- \`reason\`: Brief explanation
- Optional: 
  - \`entities_tables\`: string[] — relevant tables in entities DB
  - \`dms_tables\`: string[] — relevant tables in DMS DB

## ⚠️ Rules
- Be precise. Don't guess unless necessary.
- If unsure, use confidence 0.5 or 0.1.
- Only respond with valid JSON. No extra text.

## 📤 Output Format
{
  "target": "entities",
  "confidence": 0.9,
  "reason": "Question asks about entity banking details.",
  "entities_tables": ["bank_account", "bank", "entity"]
}

## 🚫 Example: Unknown
{
  "target": "unknown",
  "confidence": 0.1,
  "reason": "Question is unrelated to either system."
}

## 🚀 Begin
`.trim();
  }
}