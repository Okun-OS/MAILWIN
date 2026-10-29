import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { requireEnv } from "../env";
import { listAccounts } from "../mail/accounts";
import { LEVEL_LABEL } from "./permissions";
import { appendMessage, loadMessages, toApiMessages } from "./history";
import { executeTool, toolDefinitions } from "./tools";
import { MARVIN_SYSTEM_PROMPT } from "./prompt";

export const MARVIN_MODEL = "claude-opus-5-5";
const MAX_STEPS = 12;

type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return client;
}

/** Für Tests: Modellaufruf ersetzen. */
type CreateFn = (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.Messages.BetaMessage>;
let createMessage: CreateFn = (params) => anthropic().beta.messages.create(params);
export function setModelCaller(fn: CreateFn | null) {
  createMessage = fn ?? ((params) => anthropic().beta.messages.create(params));
}

export async function createConversation(userId: string, projectId?: string) {
  const [row] = await db.insert(schema.marvinConversations).values({ userId, projectId: projectId ?? null }).returning();
  return row!;
}

export async function getOwnedConversation(userId: string, conversationId: string) {
  const [row] = await db
    .select()
    .from(schema.marvinConversations)
    .where(and(eq(schema.marvinConversations.id, conversationId), eq(schema.marvinConversations.userId, userId)));
  if (!row) throw new Error("Unterhaltung nicht gefunden.");
  return row;
}

/** Aktueller Kontext als Text vor der Nutzernachricht (hält den System-Prompt stabil und cachebar). */
async function contextBlock(user: { id: string; name: string | null; timezone: string }, projectId: string | null) {
  const accounts = await listAccounts(user.id);
  const [project] = projectId ? await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)) : [];
  const now = new Date().toLocaleString("de-DE", { timeZone: user.timezone, dateStyle: "full", timeStyle: "short" });
  const lines = [
    `Jetzt: ${now} (${user.timezone})`,
    `Nutzer: ${user.name ?? "unbekannt"}`,
    accounts.length
      ? `Konten: ${accounts.map((a) => `${a.emailAddress} [account_id ${a.id}, Status ${a.status}, Stufe „${LEVEL_LABEL[a.permissionLevel]}“]`).join("; ")}`
      : "Konten: noch keines verbunden",
    ...(project
      ? [
          `Diese Unterhaltung gehört zum Projekt „${project.name}“ (project_id ${project.id}, Status ${project.status}).`,
          `Projektziel: ${project.goal ?? "noch nicht festgelegt"}`,
          "Du bist hier der Projekt- und Kommunikationsbeauftragte: Kläre fehlende Informationen, recherchiere, plane die Schritte als Aufgaben (create_task mit project_id) und halte Name/Beschreibung/Status aktuell (update_project).",
        ]
      : []),
  ];
  return `<kontext>\n${lines.join("\n")}\n</kontext>`;
}

/** Repariert einen Verlauf, falls ein früherer Lauf zwischen Tool-Aufruf und Ergebnis abgebrochen ist. */
async function repairDanglingToolUse(conversationId: string) {
  const rows = await loadMessages(conversationId);
  const last = rows[rows.length - 1];
  if (!last || last.role !== "assistant") return;
  const pending = (last.content as BetaContentBlock[]).filter((b) => b.type === "tool_use");
  if (!pending.length) return;
  await appendMessage(
    conversationId,
    "user",
    pending.map((b) => ({ type: "tool_result", tool_use_id: (b as { id: string }).id, is_error: true, content: "Abgebrochen – nicht ausgeführt." })),
  );
}

export interface MarvinTurnResult {
  stopReason: string | null;
  error?: string;
}

/**
 * Ein Gesprächsschritt: Nutzernachricht anhängen, dann den Tool-Loop fahren,
 * bis Marvin fertig ist. Jeder Schritt wird sofort gespeichert (append-only).
 */
export async function runMarvinTurn(user: { id: string; name: string | null; timezone: string }, conversationId: string, text: string): Promise<MarvinTurnResult> {
  const conversation = await getOwnedConversation(user.id, conversationId);
  await repairDanglingToolUse(conversationId);
  await appendMessage(conversationId, "user", [
    { type: "text", text: await contextBlock(user, conversation.projectId) },
    { type: "text", text },
  ]);
  if (!(await loadMessages(conversationId)).some((m) => m.role === "assistant")) {
    await db.update(schema.marvinConversations).set({ title: text.slice(0, 80) }).where(eq(schema.marvinConversations.id, conversationId));
  }

  const tools = toolDefinitions();
  for (let step = 0; step < MAX_STEPS; step++) {
    const messages = toApiMessages(await loadMessages(conversationId));
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await createMessage({
        model: MARVIN_MODEL,
        max_tokens: 16000,
        system: [{ type: "text", text: MARVIN_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        // Bei einer Ablehnung durch Sicherheitsfilter serverseitig auf das Standard-Ersatzmodell ausweichen
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return { stopReason: null, error: "Marvin ist gerade ausgelastet. Bitte gleich noch einmal versuchen." };
      if (err instanceof Anthropic.AuthenticationError) return { stopReason: null, error: "Der Zugang zur Claude-API ist ungültig (ANTHROPIC_API_KEY prüfen)." };
      if (err instanceof Anthropic.APIError) return { stopReason: null, error: `Marvin ist nicht erreichbar (${err.status ?? "Netzwerk"}).` };
      throw err;
    }

    await appendMessage(conversationId, "assistant", response.content as unknown[]);

    if (response.stop_reason === "refusal") return { stopReason: "refusal", error: "Diese Anfrage kann Marvin nicht bearbeiten." };
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") return { stopReason: response.stop_reason };

    const toolUses = response.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    const results: BetaContentBlockParam[] = [];
    for (const use of toolUses) {
      const { content, isError } = await executeTool({ userId: user.id, conversationId, toolUseId: use.id }, use.name, use.input);
      results.push({ type: "tool_result", tool_use_id: use.id, content, is_error: isError });
    }
    // Alle Ergebnisse in EINER Nachricht zurückgeben
    await appendMessage(conversationId, "user", results);
  }
  return { stopReason: "max_steps", error: "Marvin hat die maximale Zahl an Arbeitsschritten erreicht. Sag mir, ob ich weitermachen soll." };
}
