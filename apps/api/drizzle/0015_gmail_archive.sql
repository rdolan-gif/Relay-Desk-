ALTER TABLE "email_messages" ADD COLUMN "inbox_archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailbox_queues" ADD COLUMN "archive_on_close" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox_queues" ADD COLUMN "granted_scopes" text;