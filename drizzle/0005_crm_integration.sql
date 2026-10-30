CREATE TABLE "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"email_id" uuid NOT NULL,
	"activity_id" text NOT NULL,
	"lead_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_thread_links" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"contact_id" text,
	"contact_name" text,
	"contact_url" text,
	"lead_id" text,
	"lead_title" text,
	"lead_url" text,
	"lead_stage" text,
	"lead_status" text,
	"linked_by" text DEFAULT 'user' NOT NULL,
	"lead_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"webhook_secret_enc" text,
	"status" text DEFAULT 'active' NOT NULL,
	"workspace_id" text,
	"workspace_name" text,
	"workspace_app_url" text,
	"settings" jsonb DEFAULT '{"logMode":"linked","leadMode":"approval","content":"preview"}'::jsonb NOT NULL,
	"last_error" text,
	"last_webhook_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_thread_links" ADD CONSTRAINT "crm_thread_links_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_thread_links" ADD CONSTRAINT "crm_thread_links_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_activities_once" ON "crm_activities" USING btree ("integration_id","email_id");--> statement-breakpoint
CREATE INDEX "crm_thread_links_lead" ON "crm_thread_links" USING btree ("integration_id","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_kind" ON "integrations" USING btree ("user_id","kind");