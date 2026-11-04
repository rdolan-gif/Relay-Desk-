CREATE TABLE "import_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"title" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"file_key" text,
	"file_name" text,
	"file_mime" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(coalesce(body_html, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "retention_action" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "retention_days" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(body_text, ''))) STORED;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "jobs" USING btree ("created_by_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_search_gin" ON "activities" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "activities_contact_idx" ON "activities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "email_messages_search_gin" ON "email_messages" USING gin ("search_vector");--> statement-breakpoint
-- Tickets already archived: best estimate of when.
UPDATE "tickets" SET "archived_at" = "updated_at" WHERE "state" = 'archived' AND "archived_at" IS NULL;
