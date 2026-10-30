import { receiveWebhook } from "@/lib/crm/webhook";

export const dynamic = "force-dynamic";

/** Webhooks des OKUN CRM (lead.stage_changed, lead.won, lead.lost, contact.updated, ping). */
export async function POST(req: Request) {
  // Signatur gilt für den Rohbody – deshalb als Text lesen, nicht als JSON
  const raw = await req.text();
  if (raw.length > 256_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
  const { status, body } = await receiveWebhook(raw, req.headers, new URL(req.url).searchParams.get("i"));
  return Response.json(body, { status });
}
