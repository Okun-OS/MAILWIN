ALTER TABLE "connected_accounts" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "credentials_enc" text;