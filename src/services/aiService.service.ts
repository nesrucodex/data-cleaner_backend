// services/ai-service-base.ts

import { AzureOpenAI } from "openai";
import {
  AZURE_OPENAI_KEY,
  AZURE_OPENAI_DEPLOYMENT,
  AZURE_OPENAI_API_VERSION,
} from "../config/env";
import logger from "../libs/logger";

// === TYPES ===
export type AIServiceResult<T> = {
  input: T;
  output: any;
  needsReview: boolean;
  isFailed: boolean;
  suggestions?: string;
  changes?: Record<string, string>;
};

/**
 * Abstract base class for all AI services using Azure OpenAI.
 * Handles retry, concurrency, timeouts, and common configurations.
 */
export abstract class AIServiceBase<T> {
  protected openai: AzureOpenAI;

  static readonly DEFAULT_CONFIG = {
    MAX_CONCURRENT_REQUESTS: 3,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_BASE: 1000,
    TIMEOUT_MS: 30_000,
    MAX_BYTES_PER_CHUNK: 3_000,
  };

  protected config = { ...AIServiceBase.DEFAULT_CONFIG };

  constructor(config?: Partial<typeof AIServiceBase.DEFAULT_CONFIG>) {
    this.openai = new AzureOpenAI({
      apiKey: AZURE_OPENAI_KEY,
      apiVersion: AZURE_OPENAI_API_VERSION,
    });

    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Subclasses must implement their own prompt generator.
   */
  protected abstract buildUserPrompt(item: T): string;
  protected abstract buildSystemPrompt(): string;

  /**
   * Optional override: customize temperature, tokens, etc.
   */
  protected getCallOptions(): {
    temperature?: number;
    maxTokens?: number;
    jsonResponse?: boolean;
  } {
    return {
      temperature: 0.1,
      maxTokens: 2000,
      jsonResponse: true,
    };
  }

  /**
   * Main method: process batch with concurrency and retry.
   */
  async processBatch(inputs: T[]): Promise<AIServiceResult<T>[]> {
    const options = this.getCallOptions();
    const results: AIServiceResult<T>[] = [];
    const executing: Promise<void>[] = [];
    const concurrencyLimit = this.config.MAX_CONCURRENT_REQUESTS;
    let index = 0;

    while (index < inputs.length) {
      while (executing.length < concurrencyLimit && index < inputs.length) {
        const input = inputs[index];
        const currentIndex = index;

        const promise = this.processWithRetry(input)
          .then((result) => {
            results[currentIndex] = result;
          })
          .catch((error: Error) => {
            logger.error(`Item at index ${currentIndex} failed permanently`, {
              error: error.message,
            });
            results[currentIndex] = {
              input,
              output: {},
              needsReview: true,
              isFailed: true,
              suggestions: `Processing failed: ${error.message}`,
            };
          })
          .finally(() => {
            const execIndex = executing.indexOf(promise);
            if (execIndex > -1) executing.splice(execIndex, 1);
          });

        executing.push(promise);
        index++;
      }

      if (executing.length >= concurrencyLimit) {
        await Promise.race(executing);
      }
    }

    await Promise.allSettled(executing);
    return results;
  }

  /**
   * Internal: process single item with retry logic.
   */
  private async processWithRetry(input: T): Promise<AIServiceResult<T>> {
    const userPrompt = this.buildUserPrompt(input);
    const systemPrompt = this.buildSystemPrompt();
    const { temperature, maxTokens, jsonResponse } = this.getCallOptions();

    for (let attempt = 0; attempt < this.config.RETRY_ATTEMPTS; attempt++) {
      try {
        const output = await this.callAI({
          systemPrompt,
          userPrompt,
          temperature: temperature ?? 0.1,
          maxTokens: maxTokens ?? 2000,
          jsonResponse: jsonResponse ?? false,
        });

        return {
          input,
          output,
          needsReview: !!output.needsReview,
          isFailed: false,
          suggestions: output.suggestions,
          changes: output.changes,
        };
      } catch (error: any) {
        const delay = this.config.RETRY_DELAY_BASE * Math.pow(2, attempt);
        logger.warn(
          `Attempt ${attempt + 1} failed for input: ${JSON.stringify(input)}. Retrying in ${delay}ms...`,
          { error: error.message }
        );

        if (attempt < this.config.RETRY_ATTEMPTS - 1) {
          await this.delay(delay);
        } else {
          throw error;
        }
      }
    }

    throw new Error("Retry attempts exhausted");
  }

  /**
   * Call Azure OpenAI with timeout and JSON support.
   */
  private async callAI({
    systemPrompt,
    userPrompt,
    temperature,
    maxTokens,
    jsonResponse,
  }: {
    systemPrompt: string;
    userPrompt: string;
    temperature: number;
    maxTokens: number;
    jsonResponse: boolean;
  }): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.TIMEOUT_MS);

    try {
      const response = await this.openai.chat.completions.create(
        {
          model: AZURE_OPENAI_DEPLOYMENT,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: jsonResponse ? { type: "json_object" } : undefined,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) throw new Error("Empty AI response");

      return jsonResponse ? JSON.parse(content) : { raw: content };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") throw new Error("AI request timed out");
      if (error.response)
        throw new Error(`AI API error: ${error.response.status} - ${error.message}`);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Utility methods
  calculateChunkCount(items: T[]): number {
    if (!Array.isArray(items) || items.length === 0) return 0;
    const jsonSize = Buffer.byteLength(JSON.stringify(items), "utf8");
    return Math.max(1, Math.ceil(jsonSize / this.config.MAX_BYTES_PER_CHUNK));
  }

  chunk<U>(arr: U[], size: number): U[][] {
    const chunks: U[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}