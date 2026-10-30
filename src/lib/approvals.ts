import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db";
import { audit } from "./audit";
import { sendEmail, sendEmailPayload, threadAction } from "./mail/actions";
import { appendSystemNote } from "./marvin/history";
import { assertCapability } from "./marvin/permissions";
import { getOwnedAccount } from "./mail/accounts";
import { createLeadForThread } from "./crm/service";

export const crmLeadPayload = z.object({
  threadId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(10_000).default(""),
  valueCents: z.number().int().positive().optional(),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  companyName: z.string().max(160).optional(),
});

export type ApprovalRequest = typeof schema.approvalRequests.$inferSelect;

/** Aktionen, die nur über eine Freigabe ausgeführt werden können. */
const executors = {
  send_email: {
    schema: sendEmailPayload,
    run: (userId: string, payload: z.infer<typeof sendEmailPayload>) => sendEmail(userId, payload, "marvin"),
  },
  trash_thread: {
    schema: z.object({ threadId: z.string().uuid() }),
    run: async (userId: string, payload: { threadId: string }) => {
      await threadAction(userId, payload.threadId, "trash", "marvin");
      return { trashed: payload.threadId };
    },
  },
  crm_create_lead: {
    schema: crmLeadPayload,
    run: async (userId: string, payload: z.infer<typeof crmLeadPayload>) => {
      const { threadId, ...input } = payload;
      const { lead } = await createLeadForThread(userId, threadId, input, "marvin");
      return { leadId: lead.id, url: lead.url };
    },
  },
} as const;

export type ApprovalAction = keyof typeof executors;

export async function createApproval(input: {
  userId: string;
  accountId?: string | null;
  action: ApprovalAction;
  payload: Record<string, unknown>;
  summary: string;
  risk?: "normal" | "critical";
  conversationId?: string;
  toolUseId?: string;
  projectId?: string;
}): Promise<ApprovalRequest> {
  executors[input.action].schema.parse(input.payload);
  const [row] = await db
    .insert(schema.approvalRequests)
    .values({ ...input, accountId: input.accountId ?? null, risk: input.risk ?? "normal" })
    .returning();
  await db.insert(schema.notifications).values({
    userId: input.userId,
    kind: "approval_needed",
    title: "Freigabe erforderlich",
    body: input.summary,
    link: `/freigaben#${row!.id}`,
  });
  return row!;
}

async function loadPending(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.approvalRequests)
    .where(and(eq(schema.approvalRequests.id, id), eq(schema.approvalRequests.userId, userId)));
  if (!row) throw new Error("Freigabe nicht gefunden.");
  if (row.status !== "pending") throw new Error("Diese Freigabe wurde bereits bearbeitet.");
  return row;
}

/**
 * Führt eine Freigabe aus. Der Nutzer kann den Entwurf vorher ändern (`edits`);
 * ausgeführt wird exakt der gespeicherte und ggf. vom Nutzer geänderte Inhalt – nie etwas, das Marvin nachträglich ändert.
 */
export async function approve(userId: string, id: string, edits?: Record<string, unknown>) {
  const row = await loadPending(userId, id);
  const executor = executors[row.action as ApprovalAction];
  if (!executor) throw new Error(`Unbekannte Aktion: ${row.action}`);
  const payload = executor.schema.parse({ ...row.payload, ...(edits ?? {}) });
  // Stufe erneut prüfen: Der Nutzer kann sie seit dem Entwurf gesenkt oder das Konto getrennt haben
  if (row.accountId) {
    const account = await getOwnedAccount(userId, row.accountId);
    assertCapability(account, row.action === "send_email" ? "communicate" : "critical");
    if ("accountId" in payload && payload.accountId !== row.accountId) throw new Error("Das Absenderkonto kann nicht geändert werden.");
  }

  // Status zuerst atomar setzen → schützt vor Doppelklick/Doppelversand
  const claimed = await db
    .update(schema.approvalRequests)
    .set({ status: "approved", payload, decidedAt: new Date() })
    .where(and(eq(schema.approvalRequests.id, id), eq(schema.approvalRequests.status, "pending")))
    .returning({ id: schema.approvalRequests.id });
  if (!claimed.length) throw new Error("Diese Freigabe wurde bereits bearbeitet.");

  await audit({ userId, accountId: row.accountId, actor: "user", action: `approve_${row.action}`, targetType: "approval", targetId: id, status: "success", details: { edited: Boolean(edits) } });
  try {
    const result = await (executor.run as (u: string, p: unknown) => Promise<unknown>)(userId, payload);
    await db
      .update(schema.approvalRequests)
      .set({ status: "executed", result: { ok: true, ...(result as object) } })
      .where(eq(schema.approvalRequests.id, id));
    if (row.conversationId) await appendSystemNote(row.conversationId, `Der Nutzer hat „${row.summary}“ freigegeben. Ausgeführt.`);
    return { ok: true as const, result };
  } catch (err) {
    const message = String((err as Error).message ?? err);
    await db.update(schema.approvalRequests).set({ status: "failed", result: { ok: false, error: message } }).where(eq(schema.approvalRequests.id, id));
    if (row.conversationId) await appendSystemNote(row.conversationId, `Der Nutzer hat „${row.summary}“ freigegeben, die Ausführung ist aber fehlgeschlagen: ${message}`);
    return { ok: false as const, error: message };
  }
}

export async function reject(userId: string, id: string) {
  const row = await loadPending(userId, id);
  await db.update(schema.approvalRequests).set({ status: "rejected", decidedAt: new Date() }).where(eq(schema.approvalRequests.id, id));
  await audit({ userId, accountId: row.accountId, actor: "user", action: `reject_${row.action}`, targetType: "approval", targetId: id, status: "success" });
  if (row.conversationId) await appendSystemNote(row.conversationId, `Der Nutzer hat „${row.summary}“ abgelehnt. Nichts wurde ausgeführt.`);
}
