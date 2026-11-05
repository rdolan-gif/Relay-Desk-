CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"name" text NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"account_id" uuid,
	"name" text NOT NULL,
	"emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"phones" text[] DEFAULT '{}'::text[] NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crm_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"contact_form_layout" jsonb DEFAULT '{"sections":[]}'::jsonb NOT NULL,
	"account_form_layout" jsonb DEFAULT '{"sections":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crm_record_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"statuses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"form_layout" jsonb DEFAULT '{"sections":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crm_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_type_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text,
	"stage" text DEFAULT 'open' NOT NULL,
	"contact_id" uuid,
	"account_id" uuid,
	"user_id" uuid,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "filter_schemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"list" text NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_preferences" (
	"user_id" uuid NOT NULL,
	"list" text NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_preferences_user_id_list_pk" PRIMARY KEY("user_id","list")
);
--> statement-breakpoint
CREATE TABLE "rights_profile_crm_databases" (
	"rights_profile_id" uuid NOT NULL,
	"crm_database_id" uuid NOT NULL,
	CONSTRAINT "rights_profile_crm_databases_rights_profile_id_crm_database_id_pk" PRIMARY KEY("rights_profile_id","crm_database_id")
);
--> statement-breakpoint
CREATE TABLE "rights_profile_crm_record_types" (
	"rights_profile_id" uuid NOT NULL,
	"crm_record_type_id" uuid NOT NULL,
	CONSTRAINT "rights_profile_crm_record_types_rights_profile_id_crm_record_type_id_pk" PRIMARY KEY("rights_profile_id","crm_record_type_id")
);
--> statement-breakpoint
ALTER TABLE "rights_profiles" ADD COLUMN "all_crm_databases" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rights_profiles" ADD COLUMN "all_crm_record_types" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_database_id_crm_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."crm_databases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_database_id_crm_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."crm_databases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_records" ADD CONSTRAINT "crm_records_record_type_id_crm_record_types_id_fk" FOREIGN KEY ("record_type_id") REFERENCES "public"."crm_record_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_records" ADD CONSTRAINT "crm_records_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_records" ADD CONSTRAINT "crm_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_records" ADD CONSTRAINT "crm_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_schemes" ADD CONSTRAINT "filter_schemes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_entries" ADD CONSTRAINT "history_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_preferences" ADD CONSTRAINT "list_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_crm_databases" ADD CONSTRAINT "rights_profile_crm_databases_rights_profile_id_rights_profiles_id_fk" FOREIGN KEY ("rights_profile_id") REFERENCES "public"."rights_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_crm_databases" ADD CONSTRAINT "rights_profile_crm_databases_crm_database_id_crm_databases_id_fk" FOREIGN KEY ("crm_database_id") REFERENCES "public"."crm_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_crm_record_types" ADD CONSTRAINT "rights_profile_crm_record_types_rights_profile_id_rights_profiles_id_fk" FOREIGN KEY ("rights_profile_id") REFERENCES "public"."rights_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_crm_record_types" ADD CONSTRAINT "rights_profile_crm_record_types_crm_record_type_id_crm_record_types_id_fk" FOREIGN KEY ("crm_record_type_id") REFERENCES "public"."crm_record_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_database_idx" ON "accounts" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "accounts_name_idx" ON "accounts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "contacts_database_idx" ON "contacts" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "contacts_account_idx" ON "contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contacts_name_idx" ON "contacts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "contacts_emails_gin" ON "contacts" USING gin ("emails");--> statement-breakpoint
CREATE INDEX "contacts_phones_gin" ON "contacts" USING gin ("phones");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_databases_default_uq" ON "crm_databases" USING btree ("is_default") WHERE is_default AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "crm_records_type_idx" ON "crm_records" USING btree ("record_type_id");--> statement-breakpoint
CREATE INDEX "crm_records_contact_idx" ON "crm_records" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "crm_records_account_idx" ON "crm_records" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_key_uq" ON "custom_fields" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "filter_schemes_user_list_name_uq" ON "filter_schemes" USING btree ("user_id","list","name");--> statement-breakpoint
CREATE INDEX "history_entity_idx" ON "history_entries" USING btree ("entity_type","entity_id","created_at");