import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";

export async function listConversations(userId: string) {
  return db
    .select()
    .from(schema.marvinConversations)
    .where(and(eq(schema.marvinConversations.userId, userId), isNull(schema.marvinConversations.projectId)))
    .orderBy(desc(schema.marvinConversations.updatedAt))
    .limit(30);
}
