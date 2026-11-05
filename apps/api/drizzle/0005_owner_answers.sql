CREATE TABLE "ticket_merges" (
	"id" serial PRIMARY KEY NOT NULL,
	"survivor_id" integer NOT NULL,
	"merged_id" integer NOT NULL,
	"activity_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"added_follower_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "branch_code" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "phones" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "addresses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "ticket_merges" ADD CONSTRAINT "ticket_merges_survivor_id_tickets_id_fk" FOREIGN KEY ("survivor_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_merges" ADD CONSTRAINT "ticket_merges_merged_id_tickets_id_fk" FOREIGN KEY ("merged_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_merges" ADD CONSTRAINT "ticket_merges_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_merges" ADD CONSTRAINT "ticket_merges_undone_by_id_users_id_fk" FOREIGN KEY ("undone_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_merges_survivor_idx" ON "ticket_merges" USING btree ("survivor_id");--> statement-breakpoint
CREATE INDEX "accounts_parent_idx" ON "accounts" USING btree ("parent_id");