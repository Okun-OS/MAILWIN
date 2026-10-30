import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const userRef = () => uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" });

// ───────────────────────────── Nutzer & Sitzungen ─────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);
export const twoFactorMethodEnum = pgEnum("two_factor_method", ["none", "email", "sms"]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  /** Freigegebene Präferenzen (Schreibstil, Anrede …), vom Nutzer einsehbar und löschbar. */
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  role: userRoleEnum("role").notNull().default("user"),
  status: userStatusEnum("status").notNull().default("active"),
  /** scrypt-Hash, siehe lib/auth/password.ts – null, solange kein Passwort gesetzt ist */
  passwordHash: text("password_hash"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** Zweiter Faktor: Code per E-Mail (Resend) oder SMS (Twilio) */
  twoFactorMethod: twoFactorMethodEnum("two_factor_method").notNull().default("none"),
  phone: text("phone"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  adminNote: text("admin_note"),
  /** Abo – bis Stripe angebunden ist, pflegt der Admin den Stand von Hand */
  plan: text("plan").$type<"trial" | "basic" | "pro" | "business" | "internal">().notNull().default("trial"),
  subscriptionStatus: text("subscription_status").$type<"none" | "trialing" | "active" | "past_due" | "canceled">().notNull().default("trialing"),
  subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true }),
  /** Funktionen pro Kunde ab-/zuschalten, siehe lib/features.ts */
  features: jsonb("features").$type<Record<string, boolean>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable("sessions", {
  /** SHA-256 des Cookie-Tokens – das Klartext-Token liegt nur im Browser. */
  tokenHash: text("token_hash").primaryKey(),
  userId: userRef(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** false, solange der zweite Faktor noch aussteht */
  twoFactorVerified: boolean("two_factor_verified").notNull().default(true),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

/** Einmal-Codes und -Links: 2FA-Codes, Passwort-Reset, Telefonnummer bestätigen. Nur Hashes. */
export const authCodes = pgTable(
  "auth_codes",
  {
    id: id(),
    userId: userRef(),
    purpose: text("purpose").$type<"two_factor" | "password_reset" | "verify_phone" | "verify_email_2fa">().notNull(),
    codeHash: text("code_hash").notNull(),
    channel: text("channel").$type<"email" | "sms">(),
    /** z. B. die zu bestätigende Telefonnummer */
    target: text("target"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("auth_codes_user_purpose").on(t.userId, t.purpose)],
);

// ───────────────────────────── E-Mail-Konten ─────────────────────────────

export const providerEnum = pgEnum("mail_provider", ["gmail", "microsoft", "imap"]);
export const accountStatusEnum = pgEnum("account_status", ["active", "reauth_required", "error", "disconnected"]);
/**
 * Freigabestufen aus der Spezifikation (Abschnitt 14).
 * read → Stufe 1, organize → Stufe 2, communicate → Stufe 3.
 * Stufe 4 (kritische Aktionen) ist nie dauerhaft freigegeben, sondern braucht immer eine Einzelbestätigung.
 */
export const permissionLevelEnum = pgEnum("permission_level", ["read", "organize", "communicate"]);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: id(),
    userId: userRef(),
    provider: providerEnum("provider").notNull(),
    emailAddress: text("email_address").notNull(),
    displayName: text("display_name"),
    /** AES-256-GCM-verschlüsselt, siehe lib/crypto.ts */
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array().notNull().default([]),
    status: accountStatusEnum("status").notNull().default("active"),
    permissionLevel: permissionLevelEnum("permission_level").notNull().default("communicate"),
    /** Gmail historyId bzw. Delta-Token anderer Anbieter */
    syncCursor: text("sync_cursor"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    calendarEnabled: boolean("calendar_enabled").notNull().default(false),
    /** IMAP/SMTP: Server-Einstellungen (ohne Passwort) */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    /** IMAP/SMTP: Passwort bzw. App-Passwort, AES-256-GCM-verschlüsselt */
    credentialsEnc: text("credentials_enc"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("connected_accounts_user_email").on(t.userId, t.provider, t.emailAddress)],
);

export const labels = pgTable(
  "labels",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerLabelId: text("provider_label_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<"system" | "user" | "folder">().notNull(),
    color: text("color"),
  },
  (t) => [uniqueIndex("labels_account_provider").on(t.accountId, t.providerLabelId)],
);

export const emailThreads = pgTable(
  "email_threads",
  {
    id: id(),
    userId: userRef(),
    accountId: uuid("account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerThreadId: text("provider_thread_id").notNull(),
    subject: text("subject"),
    snippet: text("snippet"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    messageCount: integer("message_count").notNull().default(0),
    unread: boolean("unread").notNull().default(false),
    /** dringend | wichtig | normal | niedrig – Phase 2 (KI-Priorisierung) */
    priority: text("priority").$type<"urgent" | "important" | "normal" | "low">(),
    /** Wartet auf Antwort von Gegenseite: letzte Nachricht kam vom Nutzer */
    awaitingReplySince: timestamp("awaiting_reply_since", { withTimezone: true }),
    /** Letzte Nachricht kam von außen und ist unbeantwortet */
    needsReply: boolean("needs_reply").notNull().default(false),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("email_threads_account_provider").on(t.accountId, t.providerThreadId),
    index("email_threads_user_last").on(t.userId, t.lastMessageAt),
  ],
);

export type Address = { name?: string; email: string };

export const emails = pgTable(
  "emails",
  {
    id: id(),
    userId: userRef(),
    accountId: uuid("account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => emailThreads.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    /** RFC-822 Message-ID – für In-Reply-To/References beim Antworten */
    messageIdHeader: text("message_id_header"),
    /** References-Header – nötig, um Antworten korrekt in die Kette einzuhängen */
    references: text("references").array().notNull().default([]),
    from: jsonb("from").$type<Address>(),
    to: jsonb("to").$type<Address[]>().notNull().default([]),
    cc: jsonb("cc").$type<Address[]>().notNull().default([]),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    labelIds: text("label_ids").array().notNull().default([]),
    isRead: boolean("is_read").notNull().default(true),
    isStarred: boolean("is_starred").notNull().default(false),
    isOutgoing: boolean("is_outgoing").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    /** KI-Klassifikation, Phase 2 */
    category: text("category"),
  },
  (t) => [
    uniqueIndex("emails_account_provider").on(t.accountId, t.providerMessageId),
    index("emails_user_received").on(t.userId, t.receivedAt),
    index("emails_thread").on(t.threadId),
  ],
);

export const attachments = pgTable("attachments", {
  id: id(),
  emailId: uuid("email_id").notNull().references(() => emails.id, { onDelete: "cascade" }),
  providerAttachmentId: text("provider_attachment_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
});

// ───────────────────────────── Kontakte & Organisationen ─────────────────────────────

export const organizations = pgTable("organizations", {
  id: id(),
  userId: userRef(),
  name: text("name").notNull(),
  website: text("website"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    userId: userRef(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    name: text("name"),
    email: text("email").notNull(),
    role: text("role"),
    /** Herkunft: aus E-Mails gelernt, manuell, oder aus Recherche (dann mit Quelle) */
    source: text("source").$type<"email" | "manual" | "research">().notNull().default("email"),
    /** Nur bei Recherche: wurde die Adresse auf einer offiziellen Quelle bestätigt? */
    verified: boolean("verified").notNull().default(false),
    researchSourceId: uuid("research_source_id"),
    isImportant: boolean("is_important").notNull().default(false),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contacts_user_email").on(t.userId, t.email)],
);

// ───────────────────────────── Projekte & Aufgaben ─────────────────────────────

export const projectStatusEnum = pgEnum("project_status", ["planning", "active", "waiting", "done", "archived"]);
export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "researching",
  "draft_ready",
  "awaiting_approval",
  "sent",
  "awaiting_reply",
  "reply_received",
  "action_required",
  "done",
  "blocked",
]);

export const projects = pgTable("projects", {
  id: id(),
  userId: userRef(),
  name: text("name").notNull(),
  description: text("description"),
  goal: text("goal"),
  status: projectStatusEnum("status").notNull().default("planning"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: userRef(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("open"),
    priority: text("priority").$type<"urgent" | "important" | "normal" | "low">().notNull().default("normal"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    threadId: uuid("thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
    sourceEmailId: uuid("source_email_id").references(() => emails.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_user_status").on(t.userId, t.status)],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

export const researchSources = pgTable("research_sources", {
  id: id(),
  userId: userRef(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title"),
  excerpt: text("excerpt"),
  /** confirmed = auf offizieller Quelle belegt, assumption = plausibel, open = ungeklärt */
  confidence: text("confidence").$type<"confirmed" | "assumption" | "open">().notNull().default("open"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectEvents = pgTable("project_events", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // decision | status_change | email_linked | note
  summary: text("summary").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

// ───────────────────────────── Kalender ─────────────────────────────

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: id(),
    userId: userRef(),
    accountId: uuid("account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    conferenceProvider: text("conference_provider"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
  },
  (t) => [
    uniqueIndex("calendar_events_account_provider").on(t.accountId, t.providerEventId),
    index("calendar_events_user_start").on(t.userId, t.startsAt),
  ],
);

// ───────────────────────────── Automationen ─────────────────────────────

export const automationModeEnum = pgEnum("automation_mode", ["suggest", "approval", "auto"]);

export const automationRules = pgTable("automation_rules", {
  id: id(),
  userId: userRef(),
  accountId: uuid("account_id").references(() => connectedAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Ursprüngliche natürlichsprachliche Anweisung */
  instruction: text("instruction"),
  /** Bedingungen (alle müssen zutreffen), z. B. {type:"from", value:"rechnung@anbieter.de"} */
  conditions: jsonb("conditions").$type<Array<{ type: string; value?: string }>>().notNull().default([]),
  actions: jsonb("actions").$type<Array<{ type: string; params?: Record<string, unknown> }>>().notNull().default([]),
  mode: automationModeEnum("mode").notNull().default("suggest"),
  enabled: boolean("enabled").notNull().default(false),
  runCount: integer("run_count").notNull().default(0),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const automationExecutions = pgTable(
  "automation_executions",
  {
    id: id(),
    ruleId: uuid("rule_id").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
    emailId: uuid("email_id").references(() => emails.id, { onDelete: "set null" }),
    status: text("status").$type<"success" | "failed" | "skipped" | "pending_approval">().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  // Verhindert doppelte Ausführung derselben Regel für dieselbe E-Mail
  (t) => [uniqueIndex("automation_executions_once").on(t.ruleId, t.emailId)],
);

// ───────────────────────────── Freigaben ─────────────────────────────

export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected", "executed", "failed", "expired"]);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    userId: userRef(),
    accountId: uuid("account_id").references(() => connectedAccounts.id, { onDelete: "cascade" }),
    /** Name des Werkzeugs, z. B. send_email */
    action: text("action").notNull(),
    /** Vollständige, unveränderliche Parameter – genau das wird nach Freigabe ausgeführt */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    risk: text("risk").$type<"normal" | "critical">().notNull().default("normal"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    /** Woher die Anfrage stammt: Marvin-Unterhaltung + tool_use-ID, Automation, Projekt */
    conversationId: uuid("conversation_id"),
    toolUseId: text("tool_use_id"),
    ruleId: uuid("rule_id"),
    projectId: uuid("project_id"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("approval_requests_user_status").on(t.userId, t.status)],
);

// ───────────────────────────── Signaturen ─────────────────────────────

export const signatures = pgTable("signatures", {
  id: id(),
  userId: userRef(),
  accountId: uuid("account_id").references(() => connectedAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  html: text("html").notNull(),
  text: text("text").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

// ───────────────────────────── Benachrichtigungen & Follow-ups ─────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: userRef(),
    kind: text("kind").notNull(), // reply_received | deadline | followup_due | automation_error | sync_error | approval_needed
    title: text("title").notNull(),
    body: text("body"),
    priority: text("priority").$type<"high" | "normal" | "low">().notNull().default("normal"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_created").on(t.userId, t.createdAt)],
);

export const scheduledFollowUps = pgTable("scheduled_follow_ups", {
  id: id(),
  userId: userRef(),
  threadId: uuid("thread_id").notNull().references(() => emailThreads.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  maxReminders: integer("max_reminders").notNull().default(1),
  remindersSent: integer("reminders_sent").notNull().default(0),
  mode: automationModeEnum("mode").notNull().default("approval"),
  status: text("status").$type<"scheduled" | "cancelled" | "done">().notNull().default("scheduled"),
  createdAt: createdAt(),
});

// ───────────────────────────── Marvin ─────────────────────────────

export const marvinConversations = pgTable("marvin_conversations", {
  id: id(),
  userId: userRef(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Append-only Verlauf. `content` ist exakt das Content-Array der Claude-API,
 * damit Tool-Aufrufe und Denkblöcke unverändert zurückgespielt werden können.
 */
export const marvinMessages = pgTable(
  "marvin_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => marvinConversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: jsonb("content").$type<unknown[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("marvin_messages_seq").on(t.conversationId, t.seq)],
);

// ───────────────────────────── Audit & Jobs ─────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    userId: userRef(),
    accountId: uuid("account_id"),
    actor: text("actor").$type<"user" | "marvin" | "automation" | "system" | "admin">().notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    status: text("status").$type<"success" | "failed" | "denied">().notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_user_created").on(t.userId, t.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Verhindert doppelte Einreihung, solange ein gleichartiger Job offen ist */
    dedupeKey: text("dedupe_key"),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("jobs_runnable").on(t.status, t.runAt),
    uniqueIndex("jobs_dedupe_open").on(t.dedupeKey).where(sql`status in ('queued','running')`),
  ],
);

// ───────────────────────────── Gutscheine & Aktionen ─────────────────────────────

export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  /** Hinweistext, der während der Aktion angezeigt werden kann (z. B. auf der Website) */
  bannerText: text("banner_text"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const vouchers = pgTable("vouchers", {
  id: id(),
  code: text("code").notNull().unique(),
  description: text("description"),
  /** percent = Rabatt in %, fixed = Betrag in Cent, free_months = Gratismonate */
  kind: text("kind").$type<"percent" | "fixed" | "free_months">().notNull(),
  value: integer("value").notNull(),
  maxRedemptions: integer("max_redemptions"),
  redeemedCount: integer("redeemed_count").notNull().default(0),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const voucherRedemptions = pgTable(
  "voucher_redemptions",
  {
    id: id(),
    voucherId: uuid("voucher_id").notNull().references(() => vouchers.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email"),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("voucher_redemptions_once").on(t.voucherId, t.userId)],
);

// ───────────────────────────── Admin: Support, Meldungen, Nutzung ─────────────────────────────

export const supportNotes = pgTable(
  "support_notes",
  {
    id: id(),
    userId: userRef(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("support_notes_user").on(t.userId, t.createdAt)],
);

/** Systemmeldungen an alle Kunden (Banner in der App) */
export const announcements = pgTable("announcements", {
  id: id(),
  title: text("title").notNull(),
  body: text("body"),
  level: text("level").$type<"info" | "warning">().notNull().default("info"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Verbrauch je KI-Aufruf – Grundlage für Nutzungsstatistik und Kosten pro Kunde */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    userId: userRef(),
    kind: text("kind").notNull(), // marvin_call
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
    /** geschätzte Kosten in Mikro-US-Dollar (1 $ = 1.000.000) */
    costMicros: integer("cost_micros").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("usage_events_user_created").on(t.userId, t.createdAt)],
);
