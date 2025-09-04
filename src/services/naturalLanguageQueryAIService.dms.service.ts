// services/NaturalLanguageQueryAIService.dms.ts
import { AzureOpenAI } from "openai";
import {
  AZURE_OPENAI_API_VERSION,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_KEY,
} from "../config/env";
import { ChatCompletionMessageParam } from "openai/resources/index";

// === Types ===
export type QueryPlan = {
  sql: string;
  explanation: string;
  allowsLimit: boolean;
  limit: number;
  successStatus: boolean;
  shouldRetry: boolean;
};

export type CorrectionFeedback = {
  sql: string;
  error: string;
};

/**
 * AI Service for DMS Prod DB: Interprets natural language into safe MySQL queries
 * Now supports correction feedback from failed executions
 */
export class NaturalLanguageQueryAIServiceDMS {
  private openai: AzureOpenAI;

  private readonly MAX_RETRIES = 3;
  private readonly MAX_TOKENS = 600;

  constructor() {
    this.openai = new AzureOpenAI({
      apiKey: AZURE_OPENAI_KEY,
      apiVersion: AZURE_OPENAI_API_VERSION,
      deployment: AZURE_OPENAI_DEPLOYMENT,
      endpoint: AZURE_OPENAI_ENDPOINT || "",
    });
  }

  /**
   * Generate a SQL query plan from natural language.
   * @param question - The user's question
   * @param corrections - Optional: list of { sql, error } from prior failed attempts
   */
  async generateQueryPlan(
    question: string,
    corrections: CorrectionFeedback[] = []
  ): Promise<QueryPlan> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(question, corrections);

    let conversation: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: AZURE_OPENAI_DEPLOYMENT,
          messages: conversation,
          temperature: 0.2,
          max_tokens: this.MAX_TOKENS,
          response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) throw new Error("Empty response from AI");

        console.log({ aiAttempt: attempt, rawResponse: content });

        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          throw new Error("AI returned invalid JSON");
        }

        const result = this.validateAndSanitize(parsed);
        if (result.successStatus) return result;

        if (!result.shouldRetry) return result;

        const feedback = this.buildFeedback(parsed, result.explanation, corrections);
        conversation.push(
          { role: "assistant", content: content },
          { role: "user", content: feedback }
        );
      } catch (error: any) {
        const errorMsg = error.message || "Unknown error";
        console.warn(`Attempt ${attempt + 1} failed:`, errorMsg);

        if (attempt === this.MAX_RETRIES) {
          return this.buildFallbackQueryPlan(
            `Failed after ${this.MAX_RETRIES + 1} attempts: ${errorMsg}. Please rephrase your question.`,
            { shouldRetry: false }
          );
        }

        const feedbackMsg = `Your response was rejected: ${errorMsg}. Fix the JSON or query and respond only in valid JSON format.`;
        conversation.push({ role: "user", content: feedbackMsg });
      }
    }

    return this.buildFallbackQueryPlan("Internal error: No valid plan generated.", { shouldRetry: false });
  }

  private buildSystemPrompt(): string {
    return `
You are a senior data architect and MySQL expert for a high-scale Deal Management System (DMS). Your job is to generate the **single best, safe, and accurate SQL query** from natural language — no guesswork, no unsafe operations, no invalid assumptions.

## 🧠 Core Principles

1. **Never invent columns or tables** — rely only on this schema.
2. **Always enforce soft deletes**:
   - \`is_delete = 0\` OR \`is_delete = false\`
   - \`deleted_at IS NULL\`
3. **Never use \`SELECT *\`** — always specify required columns.
4. **Use indexed fields for joins and WHERE clauses**:
   - \`leads_transactions_id\`, \`global_organisation_id\`, \`assigned_to\`, \`created_by\`
5. **Use \`LOWER()\` for case-insensitive matching**.
6. **Use \`LIMIT ?\`** if the user implies a limit ("top", "show 5", "first 10").
7. **Avoid full table scans** — always filter early.
8. **Handle NULLs gracefully** — use \`IS NOT NULL\` or \`COALESCE\` when needed.

---

## 🗃️ Full DMS Schema Context

### 1. \`leads_tickets\` (Main Ticket Table)
- **Purpose**: Tracks support tickets, tasks, workflows.
- **Key Fields**:
  - \`id\`, \`ticket_subject\`, \`ticket_description\`
  - \`leads_transactions_id\` → links to deal/opportunity
  - \`assigned_to\` (user ID), \`deadline_date\`, \`priority\`
  - \`global_organisation_id\`, \`ledger_id\`
  - \`ticket_number\`, \`master_ticket_prefix\` (e.g., "TK")
  - \`is_delete\` (BOOLEAN), \`deleted_at\` (DATETIME)
- **Soft Delete**: Use \`is_delete = 0\` AND/OR \`deleted_at IS NULL\`
- **Index**: \`leads_transactions_id\`, \`assigned_to\`, \`global_organisation_id\`

### 2. \`leads_notes\`
- **Purpose**: Notes/comments on deals or tickets.
- **Key Fields**:
  - \`id\`, \`notes_description\`, \`leads_transactions_id\`, \`created_by\`
  - \`deleted_at\`, \`organisation_id\`
- **⚠️ Critical**: There is **NO** \`leads_tickets_id\` column.
- **Correct Join**: Always link via \`leads_transactions_id\` between \`leads_tickets\` and \`leads_notes\`.
- **Soft Delete**: \`deleted_at IS NULL\`

### 3. \`leads_transactions\` (Core Deal/Opportunity)
- **Purpose**: Represents a business deal or opportunity.
- **Key Fields**:
  - \`id\`, \`opportunity_name\`, \`product_name\`, \`finance_value\`, \`lead_status_id\`
  - \`global_organisation_id\`, \`ledger_id\`
  - \`created_at\`, \`updated_at\`
- **Index**: \`id\`, \`lead_status_id\`, \`global_organisation_id\`

### 4. \`users\`
- **Purpose**: System users.
- **Key Fields**:
  - \`id\`, \`first_name\`, \`last_name\`, \`email\`, \`global_organisation_id\`
  - \`crm_id\`, \`profile_img\`
- **Index**: \`id\`, \`email\`, \`global_organisation_id\`

### 5. \`global_organisations\`
- **Purpose**: Master data for organizations.
- **Key Fields**:
  - \`id\`, \`organisation_name\`, \`trade_name\`, \`registration_number\`
- **Index**: \`organisation_name\`, \`id\`

### 6. \`leads_tags\`
- **Purpose**: Tags on tickets or notes.
- **Key Fields**:
  - \`tag_subject\`, \`leads_transactions_id\`, \`leads_notes_id\`
  - \`is_deleted\`, \`deleted_at\`
- **Soft Delete**: \`is_deleted = false\` AND \`deleted_at IS NULL\`

### 7. \`reminders\`
- **Purpose**: Task reminders.
- **Key Fields**:
  - \`due_date_time\`, \`subject\`, \`status\`, \`closed\`, \`users_id\`

### 8. \`ledgers\`
- **Purpose**: Tenant/organization context.
- **Key Fields**: \`id\`, \`name\`, \`organisation_id\`

---

## 🔗 Common Join Patterns (Use These!)

| Use Case | Join Path |
|--------|---------|
| Tickets → Notes | \`ON t.leads_transactions_id = n.leads_transactions_id\` |
| Tickets → Users (assigned) | \`ON t.assigned_to = u.id\` |
| Tickets → Deals | \`ON t.leads_transactions_id = lt.id\` |
| Notes → Users (author) | \`ON n.created_by = u.id\` |
| Deals → Orgs | \`ON lt.global_organisation_id = go.id\` |

---

## 🛑 Forbidden Patterns

- ❌ \`JOIN leads_notes ON leads_notes.leads_tickets_id = ...\` → **Column does not exist**
- ❌ \`SELECT *\` → Always specify columns
- ❌ \`UPDATE\`, \`DELETE\`, \`INSERT\`, \`DROP\`, etc. → Only \`SELECT\`
- ❌ \`WHERE ticket_id = 'TK218552'\` → Use \`ticket_number = '218552'\` AND \`master_ticket_prefix = 'TK'\`
- ❌ Assume data exists — always validate logic

---

## 🎯 Your Goal: Be Smart & Safe

- If the request is ambiguous, **choose the most likely interpretation**.
- If multiple interpretations exist, **pick the one with highest business value**.
- Prioritize **performance** — use indexed fields, avoid full scans.
- If the request is invalid (e.g., "show invoices", "list orders"), **reject gracefully**.
- If the user says "ticket TK218552", extract number: \`ticket_number = '218552'\` AND \`master_ticket_prefix = 'TK'\`

---

## 📤 Output Format (JSON only)

{
  "sql": "SELECT ... FROM ... WHERE ... LIMIT ?",
  "explanation": "Clear, concise explanation of what the query does and why it's optimal.",
  "allowsLimit": true,
  "successStatus": true,
  "shouldRetry": false
}

---

## 🚫 Invalid or Out-of-Scope Requests

{
  "sql": "SELECT 'No valid query could be generated.' AS message",
  "explanation": "I cannot perform that action. Please ask about tickets, users, deals, notes, or tags.",
  "allowsLimit": false,
  "successStatus": false,
  "shouldRetry": false
}

---

## 💡 Example 1: Ticket by ID

User: "Show me ticket TK218552"
→
{
  "sql": "SELECT t.id, t.ticket_subject, t.ticket_description, t.deadline_date FROM leads_tickets t WHERE t.master_ticket_prefix = 'TK' AND t.ticket_number = '218552' AND t.is_delete = 0 AND t.deleted_at IS NULL LIMIT ?",
  "explanation": "Retrieves ticket TK218552 using prefix and number. Enforces soft delete filters.",
  "allowsLimit": true,
  "successStatus": true,
  "shouldRetry": false
}

## 💡 Example 2: Notes for a Ticket

User: "Show notes for ticket TK218552"
→
{
  "sql": "SELECT n.notes_description, u.first_name, u.last_name, n.created_at FROM leads_notes n JOIN leads_tickets t ON n.leads_transactions_id = t.leads_transactions_id JOIN users u ON n.created_by = u.id WHERE t.master_ticket_prefix = 'TK' AND t.ticket_number = '218552' AND t.is_delete = 0 AND n.deleted_at IS NULL LIMIT ?",
  "explanation": "Finds notes linked to the same deal as ticket TK218552. Uses correct join via leads_transactions_id.",
  "allowsLimit": true,
  "successStatus": true,
  "shouldRetry": false
}

## 💡 Example 3: High-Priority Tickets for User

User: "Top 5 high-priority tickets assigned to John"
→
{
  "sql": "SELECT t.ticket_subject, t.deadline_date, go.organisation_name FROM leads_tickets t JOIN users u ON t.assigned_to = u.id JOIN global_organisations go ON t.global_organisation_id = go.id WHERE t.is_delete = 0 AND t.deleted_at IS NULL AND u.first_name LIKE '%John%' AND t.priority > 2 LIMIT ?",
  "explanation": "Finds high-priority tickets assigned to users named John. Uses indexed joins and respects soft deletes.",
  "allowsLimit": true,
  "successStatus": true,
  "shouldRetry": false
}

---

## 🚨 Feedback from Past Errors

You will receive a list of previous failed queries and their errors. Use them to:
- Avoid repeating the same mistakes
- Correct misunderstood schema
- Fix invalid joins or filters

Example:
> "Unknown column 'n.leads_tickets_id'" → Never use this column. Use \`leads_transactions_id\` instead.

---

## 🚀 Begin
Generate only the JSON response. No extra text.
`.trim();
  }

  private buildUserPrompt(question: string, corrections: CorrectionFeedback[] = []): string {
    let prompt = `Interpret this natural language question:\n\n"${question}"\n\n`;

    if (corrections.length > 0) {
      prompt += `\nThe following attempts failed. Learn from these errors:\n`;
      corrections.forEach((corr, i) => {
        prompt += `\nFailed Query ${i + 1}: ${corr.sql}\nError: ${corr.error}\n`;
      });
      prompt += `\nNow generate a corrected query.\n`;
    }

    prompt += `
Return a JSON object with:
- "sql": the MySQL SELECT query
- "explanation": plain English
- "allowsLimit": boolean
- "successStatus": boolean
- "shouldRetry": boolean
`;
    return prompt;
  }

  private buildFeedback(
    invalidPlan: any,
    reason: string,
    corrections: CorrectionFeedback[]
  ): string {
    let feedback = `
Your previous response:
${JSON.stringify(invalidPlan, null, 2)}

Was rejected because: ${reason}

Previous execution errors:
`;

    if (corrections.length === 0) {
      feedback += "None (first attempt)\n";
    } else {
      corrections.forEach((corr, i) => {
        feedback += `Attempt ${i + 1}: "${corr.sql}" → Error: "${corr.error}"\n`;
      });
    }

    feedback += `
Please correct the issue and return a valid JSON object with:
{
  "sql": "...",
  "explanation": "...",
  "allowsLimit": boolean,
  "successStatus": boolean,
  "shouldRetry": boolean
}
Only respond with JSON. No extra text.
`;
    return feedback.trim();
  }

  private validateAndSanitize(plan: any): QueryPlan {
    try {
      if (
        !plan.sql ||
        typeof plan.explanation !== "string" ||
        typeof plan.allowsLimit !== "boolean" ||
        typeof plan.successStatus !== "boolean"
      ) {
        throw new Error("Missing or invalid fields: sql, explanation, allowsLimit, or successStatus");
      }

      if (plan.successStatus === false && plan.shouldRetry === false) {
        return {
          sql: plan.sql,
          explanation: plan.explanation,
          allowsLimit: false,
          limit: 0,
          successStatus: false,
          shouldRetry: false,
        };
      }

      let sql = plan.sql.trim();

      const forbidden = ["UPDATE", "DELETE", "INSERT", "DROP", "ALTER", "CREATE", "TRUNCATE"];
      for (const kw of forbidden) {
        if (new RegExp(`\\b${kw}\\b`, "i").test(sql)) {
          throw new Error(`Forbidden keyword: ${kw}`);
        }
      }

      if (!/^SELECT/i.test(sql)) {
        throw new Error("Only SELECT queries allowed");
      }

      sql = sql
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--.*/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i);
      const limitValue = limitMatch ? Math.min(parseInt(limitMatch[1], 10), 100) : 0;
      if (limitValue > 100 || limitMatch) {
        sql = sql.replace(/\bLIMIT\s+\d+/i, "LIMIT ?");
      }

      return {
        sql,
        explanation: plan.explanation.trim(),
        allowsLimit: Boolean(plan.allowsLimit),
        limit: limitValue,
        successStatus: true,
        shouldRetry: false,
      };
    } catch (error: any) {
      return this.buildFallbackQueryPlan(`Validation failed: ${error.message}`, { shouldRetry: true });
    }
  }

  private buildFallbackQueryPlan(reason: string, options?: { shouldRetry: boolean }): QueryPlan {
    return {
      sql: "SELECT 'No valid query could be generated.' AS message",
      explanation: `I cannot perform that action. ${reason} Please ask about tickets, users, deals, or notes.`,
      allowsLimit: false,
      limit: 0,
      successStatus: false,
      shouldRetry: options?.shouldRetry ?? true,
    };
  }
}