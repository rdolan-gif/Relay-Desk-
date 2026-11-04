CREATE TABLE "kb_article_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body_html" text NOT NULL,
	"tags" text[] NOT NULL,
	"folder_id" uuid NOT NULL,
	"edited_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author_id" uuid,
	"updated_by_id" uuid,
	"source_activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || regexp_replace(coalesce(body_html, ''), '<[^>]+>', ' ', 'g'))) STORED
);
--> statement-breakpoint
CREATE TABLE "kb_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rights_profile_kb_folders" (
	"rights_profile_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"view" boolean DEFAULT true NOT NULL,
	"create" boolean DEFAULT false NOT NULL,
	"update" boolean DEFAULT false NOT NULL,
	"delete" boolean DEFAULT false NOT NULL,
	CONSTRAINT "rights_profile_kb_folders_rights_profile_id_folder_id_pk" PRIMARY KEY("rights_profile_id","folder_id")
);
--> statement-breakpoint
ALTER TABLE "rights_profiles" ADD COLUMN "all_kb_folders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_article_versions" ADD CONSTRAINT "kb_article_versions_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_versions" ADD CONSTRAINT "kb_article_versions_edited_by_id_users_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_folder_id_kb_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."kb_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_kb_folders" ADD CONSTRAINT "rights_profile_kb_folders_rights_profile_id_rights_profiles_id_fk" FOREIGN KEY ("rights_profile_id") REFERENCES "public"."rights_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_kb_folders" ADD CONSTRAINT "rights_profile_kb_folders_folder_id_kb_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."kb_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_article_versions_uq" ON "kb_article_versions" USING btree ("article_id","version");--> statement-breakpoint
CREATE INDEX "kb_articles_folder_idx" ON "kb_articles" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "kb_articles_search_gin" ON "kb_articles" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "kb_articles_tags_gin" ON "kb_articles" USING gin ("tags");--> statement-breakpoint
-- The knowledge base is new: existing profiles get every folder until an admin narrows it.
UPDATE "rights_profiles" SET "all_kb_folders" = true;
