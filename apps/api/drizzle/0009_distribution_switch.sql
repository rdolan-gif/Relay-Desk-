ALTER TABLE "rights_profile_categories" ADD COLUMN "distribute" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing limits meant "distribute up to N" (Phase 4).
UPDATE "rights_profile_categories" SET "distribute" = true WHERE "distribution_limit" IS NOT NULL;
