// services/DataSourceRouterService.ts
import { AzureOpenAI } from "openai";
import {
  AZURE_OPENAI_API_VERSION,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_KEY,
  AZURE_OPENAI_ENDPOINT,
} from "../config/env";
import logger from "../libs/logger";

export type RoutingDecision = {
  target: "entities" | "dms" | "unknown" | "general";
  confidence: number; // 0.0 to 1.0 (more granular)
  reason: string;
  markdownResponse?: string;
  entities_tables?: string[];
  dms_tables?: string[];
  matched_pattern?: string; // For debugging
  ai_used?: boolean;        // Did we call AI?
};

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

  /**
   * MAIN ENTRY POINT — route question with exhaustive logic
   */
  async routeQuestion(question: string): Promise<RoutingDecision> {
    const start = Date.now();
    const originalQuestion = question;
    question = question.trim();

    if (!question) {
      return this.buildDecision("unknown", 0.0, "Empty question received.", { ai_used: false });
    }

    // Step 1: Normalize for pattern matching
    const normalized = this.normalizeQuestion(question);

    // Step 2: Check for general/conversational questions (client-side)
    const generalMatch = this.matchGeneralPattern(normalized);
    if (generalMatch) {
      const decision = this.buildDecision(
        "general",
        0.95,
        `Matched general pattern: ${generalMatch.pattern}`,
        {
          markdownResponse: this.buildGeneralMarkdown(question, generalMatch.category),
          matched_pattern: generalMatch.pattern,
          ai_used: false,
        }
      );
      this.logRouting("CLIENT", originalQuestion, decision, start);
      return decision;
    }

    // Step 3: Check for explicit DMS intent (client-side)
    const dmsSignal = this.analyzeDmsSignals(normalized);
    if (dmsSignal.confidence >= 0.8) {
      const decision = this.buildDecision(
        "dms",
        dmsSignal.confidence,
        `Strong DMS signal: ${dmsSignal.reason}`,
        {
          dms_tables: dmsSignal.tables,
          matched_pattern: dmsSignal.trigger,
          ai_used: false,
        }
      );
      this.logRouting("CLIENT", originalQuestion, decision, start);
      return decision;
    }

    // Step 4: Check for strong Entities intent (client-side)
    const entitiesSignal = this.analyzeEntitiesSignals(normalized);
    if (entitiesSignal.confidence >= 0.85) {
      const decision = this.buildDecision(
        "entities",
        entitiesSignal.confidence,
        `Strong Entities signal: ${entitiesSignal.reason}`,
        {
          entities_tables: entitiesSignal.tables,
          matched_pattern: entitiesSignal.trigger,
          ai_used: false,
        }
      );
      this.logRouting("CLIENT", originalQuestion, decision, start);
      return decision;
    }

    // Step 5: Call AI for ambiguous cases
    try {
      const aiDecision = await this.callAI(originalQuestion);
      if (aiDecision) {
        aiDecision.ai_used = true;
        this.logRouting("AI", originalQuestion, aiDecision, start);
        return aiDecision;
      }
    } catch (error) {
      logger.warn("AI routing failed", { error: (error as Error).message, question });
    }

    // Step 6: Final fallback — if AI failed, use signal-based routing
    if (dmsSignal.confidence > entitiesSignal.confidence) {
      const decision = this.buildDecision(
        "dms",
        Math.max(dmsSignal.confidence, 0.5),
        `Fallback: DMS signal stronger than Entities (AI failed)`,
        {
          dms_tables: dmsSignal.tables,
          matched_pattern: dmsSignal.trigger,
          ai_used: false,
        }
      );
      this.logRouting("FALLBACK", originalQuestion, decision, start);
      return decision;
    } else {
      const decision = this.buildDecision(
        "entities",
        Math.max(entitiesSignal.confidence, 0.7), // Bias toward entities
        `Fallback: Entities signal stronger or default (AI failed)`,
        {
          entities_tables: entitiesSignal.tables,
          matched_pattern: entitiesSignal.trigger,
          ai_used: false,
        }
      );
      this.logRouting("FALLBACK", originalQuestion, decision, start);
      return decision;
    }
  }

  // ─── CLIENT-SIDE PATTERN MATCHING ────────────────────────────────────

  private normalizeQuestion(q: string): string {
    return q
      .toLowerCase()
      .trim()
      .replace(/[^\w\s\-]/g, " ") // Remove punctuation except hyphens
      .replace(/\s+/g, " ");      // Normalize whitespace
  }

  private matchGeneralPattern(q: string): { pattern: string; category: string } | null {
    const patterns = [
      // Greetings
      { pattern: /^hi|hello|hey|yo|sup|greetings|good morning|good afternoon|good evening$/i, category: "greeting" },
      // Identity
      { pattern: /^who are you|what are you|are you (an? )?(ai|bot|assistant|llm)/i, category: "identity" },
      // Capabilities
      { pattern: /^what can you do|how can you help|what (are|is) your (abilities|capabilities|features)/i, category: "capabilities" },
      // Help
      { pattern: /^help|assist me|guide me|show me how|instructions|manual/i, category: "help" },
      // Feedback
      { pattern: /^thank you|thanks|appreciate|great job|well done/i, category: "feedback" },
      // Meta
      { pattern: /^what is this|what is this system|explain this|how does this work|purpose of this/i, category: "meta" },
    ];

    for (const { pattern, category } of patterns) {
      if (pattern.test(q)) {
        return { pattern: pattern.toString(), category };
      }
    }
    return null;
  }

  private analyzeDmsSignals(q: string): { confidence: number; reason: string; tables: string[]; trigger: string } {
    const signals = [
      // High confidence (0.9+)
      { keyword: "ticket", weight: 0.95, tables: ["leads_tickets"], context: "explicit ticket reference" },
      { keyword: "tk\\d+", weight: 0.95, tables: ["leads_tickets"], context: "ticket ID format" },
      { keyword: "note", weight: 0.9, tables: ["leads_notes"], context: "explicit note reference" },
      { keyword: "task", weight: 0.9, tables: ["leads_tickets"], context: "explicit task reference" },
      { keyword: "reminder", weight: 0.9, tables: ["reminders"], context: "explicit reminder reference" },
      { keyword: "assigned to", weight: 0.9, tables: ["leads_tickets", "users"], context: "assignment context" },
      { keyword: "deadline", weight: 0.9, tables: ["leads_tickets"], context: "deadline context" },
      { keyword: "status", weight: 0.85, tables: ["leads_tickets"], context: "status context" },
      { keyword: "tag", weight: 0.85, tables: ["leads_tags"], context: "tag context" },
      { keyword: "lead", weight: 0.85, tables: ["leads_transactions"], context: "lead context" },
      { keyword: "opportunity", weight: 0.85, tables: ["leads_transactions"], context: "opportunity context" },
      { keyword: "transaction", weight: 0.8, tables: ["leads_transactions"], context: "transaction context" },
      { keyword: "owned by", weight: 0.8, tables: ["leads_tickets", "users"], context: "ownership context" },
      { keyword: "created by", weight: 0.8, tables: ["leads_notes", "users"], context: "authorship context" },
      { keyword: "updated by", weight: 0.8, tables: ["leads_tickets", "users"], context: "update context" },

      // Medium confidence (0.7-0.8)
      { keyword: "follow up", weight: 0.75, tables: ["leads_tickets"], context: "follow-up context" },
      { keyword: "pending", weight: 0.75, tables: ["leads_tickets"], context: "pending status" },
      { keyword: "overdue", weight: 0.75, tables: ["leads_tickets"], context: "overdue context" },
      { keyword: "priority", weight: 0.7, tables: ["leads_tickets"], context: "priority context" },
      { keyword: "escalate", weight: 0.7, tables: ["leads_tickets"], context: "escalation context" },
    ];

    let maxConfidence = 0;
    let bestReason = "";
    let bestTables: string[] = [];
    let bestTrigger = "";

    for (const signal of signals) {
      const regex = new RegExp(`\\b${signal.keyword}\\b`, "i");
      if (regex.test(q)) {
        if (signal.weight > maxConfidence) {
          maxConfidence = signal.weight;
          bestReason = signal.context;
          bestTables = [...signal.tables];
          bestTrigger = signal.keyword;
        }
      }
    }

    return {
      confidence: maxConfidence,
      reason: bestReason,
      tables: bestTables,
      trigger: bestTrigger,
    };
  }

  private analyzeEntitiesSignals(q: string): { confidence: number; reason: string; tables: string[]; trigger: string } {
    const signals = [
      // Very High confidence (0.95+)
      { keyword: "entity", weight: 0.98, tables: ["entity"], context: "explicit entity reference" },
      { keyword: "company", weight: 0.95, tables: ["entity"], context: "company context" },
      { keyword: "organization", weight: 0.95, tables: ["entity"], context: "organization context" },
      { keyword: "person", weight: 0.95, tables: ["people"], context: "person context" },
      { keyword: "individual", weight: 0.95, tables: ["people"], context: "individual context" },
      { keyword: "bank account", weight: 0.95, tables: ["bank_account"], context: "bank account context" },
      { keyword: "iban", weight: 0.95, tables: ["bank_account"], context: "IBAN context" },
      { keyword: "swift", weight: 0.95, tables: ["bank"], context: "SWIFT context" },
      { keyword: "bic", weight: 0.95, tables: ["bank"], context: "BIC context" },
      { keyword: "address", weight: 0.95, tables: ["address"], context: "address context" },
      { keyword: "risk rating", weight: 0.95, tables: ["entity_risk_and_rates"], context: "risk rating context" },
      { keyword: "credit limit", weight: 0.95, tables: ["entity_risk_and_rates"], context: "credit limit context" },
      { keyword: "role", weight: 0.9, tables: ["entity_role", "role"], context: "role context" },
      { keyword: "debtor", weight: 0.9, tables: ["entity_role", "role"], context: "debtor context" },
      { keyword: "creditor", weight: 0.9, tables: ["entity_role", "role"], context: "creditor context" },
      { keyword: "originator", weight: 0.9, tables: ["entity_role", "role"], context: "originator context" },
      { keyword: "contact", weight: 0.9, tables: ["entity_contact", "people"], context: "contact context" },
      { keyword: "email", weight: 0.9, tables: ["entity_property"], context: "email context" },
      { keyword: "phone", weight: 0.9, tables: ["entity_property"], context: "phone context" },
      { keyword: "website", weight: 0.9, tables: ["entity_property"], context: "website context" },
      { keyword: "asset", weight: 0.9, tables: ["asset"], context: "asset context" },
      { keyword: "property", weight: 0.85, tables: ["entity_property", "property"], context: "property context" },
      { keyword: "country", weight: 0.85, tables: ["param_country", "address"], context: "country context" },
      { keyword: "city", weight: 0.85, tables: ["address"], context: "city context" },
      { keyword: "state", weight: 0.85, tables: ["address"], context: "state context" },
      { keyword: "zipcode", weight: 0.85, tables: ["address"], context: "zipcode context" },
      { keyword: "trade name", weight: 0.85, tables: ["entity"], context: "trade name context" },
      { keyword: "legal name", weight: 0.85, tables: ["entity"], context: "legal name context" },
      { keyword: "registration number", weight: 0.85, tables: ["global_organisations"], context: "registration context" },

      // Medium confidence (0.7-0.8)
      { keyword: "client", weight: 0.8, tables: ["entity"], context: "client context" },
      { keyword: "customer", weight: 0.8, tables: ["entity"], context: "customer context" },
      { keyword: "vendor", weight: 0.8, tables: ["entity"], context: "vendor context" },
      { keyword: "supplier", weight: 0.8, tables: ["entity"], context: "supplier context" },
      { keyword: "partner", weight: 0.8, tables: ["entity"], context: "partner context" },
      { keyword: "employee", weight: 0.75, tables: ["people"], context: "employee context" },
      { keyword: "director", weight: 0.75, tables: ["people"], context: "director context" },
      { keyword: "manager", weight: 0.75, tables: ["people"], context: "manager context" },
      { keyword: "owner", weight: 0.75, tables: ["entity_mapping"], context: "ownership context" },
      { keyword: "parent company", weight: 0.75, tables: ["entity_mapping"], context: "parent context" },
      { keyword: "subsidiary", weight: 0.75, tables: ["entity_mapping"], context: "subsidiary context" },
      { keyword: "currency", weight: 0.7, tables: ["bank_account"], context: "currency context" },
      { keyword: "balance", weight: 0.7, tables: ["bank_account"], context: "balance context" },
    ];

    let maxConfidence = 0;
    let bestReason = "";
    let bestTables: string[] = [];
    let bestTrigger = "";

    for (const signal of signals) {
      const regex = new RegExp(`\\b${signal.keyword}\\b`, "i");
      if (regex.test(q)) {
        if (signal.weight > maxConfidence) {
          maxConfidence = signal.weight;
          bestReason = signal.context;
          bestTables = [...signal.tables];
          bestTrigger = signal.keyword;
        }
      }
    }

    // If no strong signal, default to entities with medium confidence
    if (maxConfidence === 0) {
      return {
        confidence: 0.75,
        reason: "No specific signal detected — defaulting to Entities (primary system)",
        tables: ["entity", "people", "address"],
        trigger: "default",
      };
    }

    return {
      confidence: maxConfidence,
      reason: bestReason,
      tables: bestTables,
      trigger: bestTrigger,
    };
  }

  // ─── AI LAYER ────────────────────────────────────────────────────────

  private async callAI(question: string): Promise<RoutingDecision | null> {
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
        max_tokens: 600,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        logger.warn("AI returned empty response", { question });
        return null;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        logger.warn("AI returned invalid JSON", { content, error: parseError });
        return null;
      }

      // Validate structure
      if (!["entities", "dms", "unknown", "general"].includes(parsed.target)) {
        logger.warn("AI returned invalid target", { parsed });
        return null;
      }

      // Ensure markdownResponse for general
      if (parsed.target === "general" && !parsed.markdownResponse) {
        parsed.markdownResponse = this.buildGeneralMarkdown(question, "ai_fallback");
      }

      return {
        target: parsed.target,
        confidence: typeof parsed.confidence === "number" ? Math.min(1.0, Math.max(0.0, parsed.confidence)) : 0.5,
        reason: parsed.reason || "AI decision",
        markdownResponse: parsed.markdownResponse,
        entities_tables: Array.isArray(parsed.entities_tables) ? parsed.entities_tables : undefined,
        dms_tables: Array.isArray(parsed.dms_tables) ? parsed.dms_tables : undefined,
        ai_used: true,
      };
    } catch (error) {
      logger.error("AI routing call failed", { error: (error as Error).message, question });
      return null;
    }
  }

  // ─── MARKDOWN & RESPONSE BUILDING ────────────────────────────────────

  private buildGeneralMarkdown(question: string, category: string): string {
    const templates = {
      greeting: `
# 👋 Hello!

Thanks for saying hello! I'm your AI Data Assistant — here to help you find information across our systems.

## 💡 Quick Start

- Ask about **companies, people, or addresses** → I'll search Entities DB
- Ask about **tickets or tasks** → I'll check DMS
- Type **"help"** anytime for examples

> _Just type your question — I'm listening!_
`.trim(),

      identity: `
# 🤖 I'm Your AI Data Assistant

I'm powered by Azure OpenAI and connected to your company's **Entities** and **DMS** databases.

## 🧠 What I Know

- **Entities DB**: Companies, people, addresses, bank accounts, risk profiles (primary source)
- **DMS**: Tickets, notes, tasks, reminders (legacy system)

## 🚀 Try Asking

- "Show me Google LLC's bank accounts"
- "Who is assigned to TK218552?"
- "List all people in New York"

> *No SQL needed — just ask in plain English!*
`.trim(),

      capabilities: `
# 💪 Here's What I Can Do

## 🏢 Entities System (Primary)
- Find companies, people, contacts
- Look up addresses, phone numbers, emails
- Check bank accounts (IBAN/SWIFT)
- View risk ratings and credit limits

## 📂 DMS System (Tickets & Tasks)
- Check ticket status (e.g., "TK218552")
- Find notes or reminders
- See who's assigned to a task
- List overdue items

## 🧩 Smart Features
- Auto-correct SQL errors
- Explain my reasoning in plain English
- Return results in easy-to-read tables

> Try: "Show me all creditors with risk rating A"
`.trim(),

      help: `
# 🆘 Need Help? Here Are Some Examples

## 🏢 Entities Queries
- "What's the address of Microsoft Corp?"
- "Show me all bank accounts for entity 1001"
- "List people with email @google.com"
- "What's Acme Inc's risk rating?"

## 📂 DMS Queries
- "Status of ticket TK218552?"
- "Show notes for deal X"
- "Who is assigned to ticket 5001?"
- "List all overdue tasks"

## 💬 General
- "Who are you?"
- "What can you do?"
- "Help me get started"

> Just type your question — I'll figure out where to look!
`.trim(),

      feedback: `
# 🙏 Thank You!

I'm glad I could help! Remember:

- For **company/people data** → Entities DB
- For **tickets/tasks** → DMS
- Type **"help"** anytime for examples

Is there anything else I can assist you with?
`.trim(),

      meta: `
# ℹ️ About This System

This is an AI-powered data query interface connected to:

## 🏢 Entities Database (Primary)
- Companies, people, addresses, bank accounts, risk profiles
- Canonical source for 90%+ of business data

## 📂 DMS Database (Legacy)
- Tickets, notes, tasks, reminders
- Being migrated to Entities over time

## 🤖 AI Engine
- Powered by Azure OpenAI
- Self-correcting SQL generation
- Markdown-formatted responses

> Ask me anything — I'll route your question to the right system!
`.trim(),

      default: `
# 💬 "${question}"

I detected this as a general question. Here's how I can help:

## 🚀 Quick Actions
- Type **"help"** for examples
- Ask about **companies, people, or addresses**
- Ask about **tickets or tasks**

## 🧩 Systems I Access
- **Entities DB** (primary): Companies, people, bank, risk
- **DMS** (secondary): Tickets, notes, reminders

> Just ask in plain English — no SQL required!
`.trim(),
    };

    return templates[category as keyof typeof templates] || templates.default;
  }

  // ─── UTILITIES ───────────────────────────────────────────────────────

  private buildDecision(
    target: RoutingDecision["target"],
    confidence: number,
    reason: string,
    options: Partial<Omit<RoutingDecision, "target" | "confidence" | "reason">> = {}
  ): RoutingDecision {
    return {
      target,
      confidence: Math.min(1.0, Math.max(0.0, confidence)),
      reason,
      ...options,
    };
  }

  private logRouting(
    source: "CLIENT" | "AI" | "FALLBACK",
    question: string,
    decision: RoutingDecision,
    startTime: number
  ) {
    const duration = Date.now() - startTime;
    logger.info("Routing Decision", {
      source,
      question,
      target: decision.target,
      confidence: decision.confidence,
      reason: decision.reason,
      matched_pattern: decision.matched_pattern,
      ai_used: decision.ai_used,
      duration_ms: duration,
    });
  }

  // ─── SYSTEM PROMPT ───────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return `
You are an expert data routing engine for a modern enterprise system with two databases:

## 🏢 PRIMARY: Entities Database
- Contains canonical, migrated data for:
  - Companies, organizations, legal entities
  - People, contacts, directors
  - Addresses, phone numbers, emails
  - Bank accounts (IBAN, SWIFT), risk ratings, credit limits
  - Roles (debtor, creditor, originator)
- Key tables: entity, people, address, bank_account, entity_risk_and_rates, entity_role

## 📂 SECONDARY: DMS Database (Legacy/Migration)
- ONLY for workflow and ticketing:
  - Tickets (e.g., TK218552), tasks, reminders
  - Notes, tags, assignments
  - Users, deadlines, statuses
- Key tables: leads_tickets, leads_notes, leads_transactions, users, reminders

## 🎯 ROUTING RULES

1. If question is conversational → target: "general", include markdownResponse
2. If question is about companies, people, addresses, bank, risk → target: "entities"
3. ONLY if question explicitly mentions tickets, notes, tasks, reminders → target: "dms"
4. If truly ambiguous → target: "entities" (it's the primary system)
5. NEVER return "unknown" unless question is completely unrelated to business data

## 📤 OUTPUT FORMAT (STRICT JSON)

{
  "target": "entities" | "dms" | "unknown" | "general",
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "markdownResponse": "required if target=general",
  "entities_tables": ["table1", "table2"],
  "dms_tables": ["table1", "table2"]
}

## 💬 EXAMPLES

### General
{
  "target": "general",
  "confidence": 0.95,
  "reason": "User asked 'Who are you?'",
  "markdownResponse": "# 🤖 I'm Your AI Data Assistant\\n\\nI help you query Entities and DMS data..."
}

### Entities
{
  "target": "entities",
  "confidence": 0.92,
  "reason": "Question asks about company address",
  "entities_tables": ["entity", "address"]
}

### DMS
{
  "target": "dms",
  "confidence": 0.9,
  "reason": "Question asks about ticket status",
  "dms_tables": ["leads_tickets", "users"]
}

## 🚫 Begin — respond only in JSON
`.trim();
  }
}