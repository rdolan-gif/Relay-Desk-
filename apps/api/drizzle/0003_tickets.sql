CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" integer,
	"type" text NOT NULL,
	"channel" text DEFAULT 'internal' NOT NULL,
	"direction" text DEFAULT 'internal' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"is_external" boolean DEFAULT false NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"mention_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"replied_to_activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"status_required" text DEFAULT 'never' NOT NULL,
	"multiple_statuses" boolean DEFAULT false NOT NULL,
	"check_child_on_close" boolean DEFAULT false NOT NULL,
	"auto_archive_days" integer,
	"allow_external_comments" boolean DEFAULT false NOT NULL,
	"waiting_requires_reopen" boolean DEFAULT false NOT NULL,
	"default_crm_database_id" uuid,
	"form_layout" jsonb DEFAULT '{"sections":[]}'::jsonb NOT NULL,
	"autofocus_tab" text DEFAULT 'form' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "category_statuses" (
	"category_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	CONSTRAINT "category_statuses_category_id_status_id_pk" PRIMARY KEY("category_id","status_id")
);
--> statement-breakpoint
CREATE TABLE "rights_profile_categories" (
	"rights_profile_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"access" boolean DEFAULT true NOT NULL,
	"distribution_limit" integer,
	CONSTRAINT "rights_profile_categories_rights_profile_id_category_id_pk" PRIMARY KEY("rights_profile_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "rights_profile_ticket_views" (
	"rights_profile_id" uuid NOT NULL,
	"view_id" uuid NOT NULL,
	CONSTRAINT "rights_profile_ticket_views_rights_profile_id_view_id_pk" PRIMARY KEY("rights_profile_id","view_id")
);
--> statement-breakpoint
CREATE TABLE "sidebar_items" (
	"user_id" uuid NOT NULL,
	"view_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"folder" text,
	"parent_view_id" uuid,
	CONSTRAINT "sidebar_items_user_id_view_id_pk" PRIMARY KEY("user_id","view_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_favourites" (
	"ticket_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "ticket_favourites_ticket_id_user_id_pk" PRIMARY KEY("ticket_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_followers" (
	"ticket_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "ticket_followers_ticket_id_user_id_pk" PRIMARY KEY("ticket_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" uuid NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"status_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"parent_id" integer,
	"merged_into_id" integer,
	"source_activity_id" uuid,
	"deadline" timestamp with time zone,
	"reopen_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_anonymised" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "history_entries" ALTER COLUMN "entity_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rights_profiles" ADD COLUMN "all_categories" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rights_profiles" ADD COLUMN "all_ticket_views" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_default_crm_database_id_crm_databases_id_fk" FOREIGN KEY ("default_crm_database_id") REFERENCES "public"."crm_databases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_statuses" ADD CONSTRAINT "category_statuses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_statuses" ADD CONSTRAINT "category_statuses_status_id_ticket_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."ticket_statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_categories" ADD CONSTRAINT "rights_profile_categories_rights_profile_id_rights_profiles_id_fk" FOREIGN KEY ("rights_profile_id") REFERENCES "public"."rights_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_categories" ADD CONSTRAINT "rights_profile_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_ticket_views" ADD CONSTRAINT "rights_profile_ticket_views_rights_profile_id_rights_profiles_id_fk" FOREIGN KEY ("rights_profile_id") REFERENCES "public"."rights_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_ticket_views" ADD CONSTRAINT "rights_profile_ticket_views_view_id_ticket_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."ticket_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_items" ADD CONSTRAINT "sidebar_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_items" ADD CONSTRAINT "sidebar_items_view_id_ticket_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."ticket_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_favourites" ADD CONSTRAINT "ticket_favourites_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_favourites" ADD CONSTRAINT "ticket_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_followers" ADD CONSTRAINT "ticket_followers_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_followers" ADD CONSTRAINT "ticket_followers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_views" ADD CONSTRAINT "ticket_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_ticket_idx" ON "activities" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_followers_user_idx" ON "ticket_followers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tickets_category_idx" ON "tickets" USING btree ("category_id","state");--> statement-breakpoint
CREATE INDEX "tickets_user_idx" ON "tickets" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "tickets_contact_idx" ON "tickets" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "tickets_parent_idx" ON "tickets" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tickets_reopen_idx" ON "tickets" USING btree ("reopen_at");