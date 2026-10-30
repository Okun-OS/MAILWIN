import type Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "./db";

/**
 * Listenpreise in US-Dollar je 1 Mio. Tokens (Stand Oktober 2026) – nur für die Kostenschätzung im Admin.
 * Abrechnungsrelevant ist allein die Rechnung von Anthropic.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
const WEB_SEARCH_USD = 0.01;

export function estimateCostMicros(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number }) {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"]!;
  const usd = (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000 + u.webSearches * WEB_SEARCH_USD;
  return Math.round(usd * 1_000_000);
}

export async function recordUsage(userId: string, response: Anthropic.Beta.Messages.BetaMessage) {
  const u = response.usage;
  const values = {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
    webSearches: u?.server_tool_use?.web_search_requests ?? 0,
  };
  await db.insert(schema.usageEvents).values({
    userId,
    kind: "marvin_call",
    model: response.model,
    inputTokens: values.input,
    outputTokens: values.output,
    cacheReadTokens: values.cacheRead,
    cacheWriteTokens: values.cacheWrite,
    webSearches: values.webSearches,
    costMicros: estimateCostMicros(response.model, values),
  });
}

export const formatUsd = (micros: number) => `${(micros / 1_000_000).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
