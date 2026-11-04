CREATE TABLE "macro_categories" (
	"macro_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "macro_categories_macro_id_category_id_pk" PRIMARY KEY("macro_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "macros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"colour" text DEFAULT 'blue' NOT NULL,
	"position" text DEFAULT 'button' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"owner" boolean DEFAULT false NOT NULL,
	"followed" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"activity" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_rules_user_id_category_id_pk" PRIMARY KEY("user_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ticket_id" integer,
	"actor_id" uuid,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rights_profile_macros" (
	"rights_profile_id" uuid NOT NULL,
	"macro_id" uuid NOT NULL,
	CONSTRAINT "rights_profile_macros_rights_profile_id_macro_id_pk" PRIMARY KEY("rights_profile_id","macro_id")
);
--> statement-breakpoint
ALTER TABLE "mailbox_queues" ADD COLUMN "sends_notifications" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rights_profiles" ADD COLUMN "all_macros" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_email" text;--> statement-breakpoint
ALTER TABLE "macro_categories" ADD CONSTRAINT "macro_categories_macro_id_macros_id_fk" FOREIGN KEY ("macro_id") REFERENCES "public"."macros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_categories" ADD CONSTRAINT "macro_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_macros" ADD CONSTRAINT "rights_profile_macros_rights_profile_id_rights_profiles_id_fk" FOREIGN KEY ("rights_profile_id") REFERENCES "public"."rights_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_macros" ADD CONSTRAINT "rights_profile_macros_macro_id_macros_id_fk" FOREIGN KEY ("macro_id") REFERENCES "public"."macros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
-- Macros are new: existing profiles may run every macro until an admin narrows it.
UPDATE "rights_profiles" SET "all_macros" = true;
