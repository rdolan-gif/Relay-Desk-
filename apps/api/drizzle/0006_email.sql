CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text NOT NULL,
	"content_id" text,
	"inline" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"activity_id" uuid PRIMARY KEY NOT NULL,
	"queue_id" uuid,
	"provider_message_id" text,
	"provider_thread_id" text,
	"message_id" text,
	"in_reply_to" text,
	"references" text[] DEFAULT '{}'::text[] NOT NULL,
	"from" jsonb NOT NULL,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"classification" text DEFAULT 'normal' NOT NULL,
	"raw_storage_key" text,
	"scheduled_for" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'reply' NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"body_html" text DEFAULT '' NOT NULL,
	"queue_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"category_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbound_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"queue_id" uuid NOT NULL,
	"provider_message_id" text NOT NULL,
	"outcome" text NOT NULL,
	"ticket_id" integer,
	"activity_id" uuid,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_queue_crm_databases" (
	"queue_id" uuid NOT NULL,
	"crm_database_id" uuid NOT NULL,
	CONSTRAINT "mailbox_queue_crm_databases_queue_id_crm_database_id_pk" PRIMARY KEY("queue_id","crm_database_id")
);
--> statement-breakpoint
CREATE TABLE "mailbox_queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"address" text NOT NULL,
	"sender_name" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"default_category_id" uuid NOT NULL,
	"header_threading" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"auto_response_enabled" boolean DEFAULT false NOT NULL,
	"auto_response_new_only" boolean DEFAULT true NOT NULL,
	"auto_response_template_id" uuid,
	"default_body_template_id" uuid,
	"credentials_enc" text,
	"connected_as" text,
	"sync_cursor" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rights_profile_mailboxes" (
	"rights_profile_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	CONSTRAINT "rights_profile_mailboxes_rights_profile_id_queue_id_pk" PRIMARY KEY("rights_profile_id","queue_id")
);
--> statement-breakpoint
CREATE TABLE "routing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"direction" text DEFAULT 'incoming' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"all_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"any_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "suggested_ticket_ids" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "is_automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "rights_profiles" ADD COLUMN "all_mailboxes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_answer_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "no_reply_needed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_queue_id_mailbox_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."mailbox_queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_log" ADD CONSTRAINT "inbound_log_queue_id_mailbox_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."mailbox_queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_queue_crm_databases" ADD CONSTRAINT "mailbox_queue_crm_databases_queue_id_mailbox_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."mailbox_queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_queue_crm_databases" ADD CONSTRAINT "mailbox_queue_crm_databases_crm_database_id_crm_databases_id_fk" FOREIGN KEY ("crm_database_id") REFERENCES "public"."crm_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_queues" ADD CONSTRAINT "mailbox_queues_default_category_id_categories_id_fk" FOREIGN KEY ("default_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_mailboxes" ADD CONSTRAINT "rights_profile_mailboxes_rights_profile_id_rights_profiles_id_fk" FOREIGN KEY ("rights_profile_id") REFERENCES "public"."rights_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_profile_mailboxes" ADD CONSTRAINT "rights_profile_mailboxes_queue_id_mailbox_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."mailbox_queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "email_messages_message_id_idx" ON "email_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_messages_queue_idx" ON "email_messages" USING btree ("queue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_log_queue_msg_uq" ON "inbound_log" USING btree ("queue_id","provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_queues_address_uq" ON "mailbox_queues" USING btree ("address") WHERE deleted_at IS NULL;