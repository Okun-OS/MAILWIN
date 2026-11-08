import Anthropic from "@anthropic-ai/sdk";
import { env, requireEnv } from "./env";

/** Modell für Marvin und die Signal-Erkennung. */
export const CLAUDE_MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
export function anthropic() {
  client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return client;
}

let override: boolean | null = null;
/** Ist die Claude-API eingerichtet? (In Tests umschaltbar, die Modellaufrufe sind dort ersetzt.) */
export const aiConfigured = () => override ?? Boolean(env.ANTHROPIC_API_KEY);
export function setAiConfigured(value: boolean | null) {
  override = value;
}
