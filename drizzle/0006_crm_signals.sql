CREATE TABLE "crm_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"lead_id" text NOT NULL,
	"signal" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"confidence" real,
	"quote" text,
	"summary" text,
	"applied" text[] DEFAULT '{}' NOT NULL,
	"ignored" text[] DEFAULT '{}' NOT NULL,
	"proposals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_action_title" text,
	"next_action_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_activities" ALTER COLUMN "activity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "signals_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_thread_links" ADD COLUMN "next_action_type" text;--> statement-breakpoint
ALTER TABLE "crm_thread_links" ADD COLUMN "next_action_title" text;--> statement-breakpoint
ALTER TABLE "crm_thread_links" ADD COLUMN "next_action_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_thread_links" ADD COLUMN "operational_state" text;--> statement-breakpoint
ALTER TABLE "crm_signals" ADD CONSTRAINT "crm_signals_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_signals" ADD CONSTRAINT "crm_signals_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_signals" ADD CONSTRAINT "crm_signals_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_signals_once" ON "crm_signals" USING btree ("integration_id","email_id","signal");--> statement-breakpoint
CREATE INDEX "crm_signals_thread" ON "crm_signals" USING btree ("thread_id");
--> statement-breakpoint
-- Bereits gemeldete Nachrichten gelten als geprüft: Signale nur für Nachrichten ab dieser Version
UPDATE "crm_activities" SET "signals_checked_at" = "created_at" WHERE "signals_checked_at" IS NULL;
