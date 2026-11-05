CREATE TABLE "queue_logins" (
	"user_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_logins_user_id_queue_id_pk" PRIMARY KEY("user_id","queue_id")
);
--> statement-breakpoint
CREATE TABLE "sla_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"unit" text DEFAULT 'hours' NOT NULL,
	"basis_field_id" uuid,
	"targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "time_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"week" jsonb NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "sla_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "sla_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "time_group_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_answer_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "deadline_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "waiting_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sla_paused_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "first_answer_met" boolean;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "solution_met" boolean;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "distributable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_distributed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "queue_logins" ADD CONSTRAINT "queue_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_logins" ADD CONSTRAINT "queue_logins_queue_id_mailbox_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."mailbox_queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_definitions" ADD CONSTRAINT "sla_definitions_basis_field_id_custom_fields_id_fk" FOREIGN KEY ("basis_field_id") REFERENCES "public"."custom_fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_sla_id_sla_definitions_id_fk" FOREIGN KEY ("sla_id") REFERENCES "public"."sla_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_sla_id_sla_definitions_id_fk" FOREIGN KEY ("sla_id") REFERENCES "public"."sla_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_time_group_id_time_groups_id_fk" FOREIGN KEY ("time_group_id") REFERENCES "public"."time_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_backlog_idx" ON "tickets" USING btree ("category_id","created_at") WHERE distributable AND user_id IS NULL AND state = 'open' AND deleted_at IS NULL;