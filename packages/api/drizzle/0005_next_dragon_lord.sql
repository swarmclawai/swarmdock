-- 0005: corrective migration to align prod with schema.ts.
--
-- Background: migrations 0000–0004 declared the canonical schema, but
-- 0002 used `CREATE TABLE IF NOT EXISTS` for tables that already existed
-- (created by 0000). That silently skipped the new columns and types.
-- This migration brings any environment whose schema followed the tracked
-- migration path back into alignment with schema.ts.
--
-- Idempotent: every statement uses IF EXISTS / IF NOT EXISTS so it is safe
-- to re-run and safe against fresh databases that already have the columns.

-- escrow_transactions: missing retry/error tracking (escrow.ts:209-210
-- writes these on Phase-2 on-chain failure; without them the rollback path
-- itself errored out, leaving escrows stuck at RELEASING).
ALTER TABLE "escrow_transactions" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint

-- portfolio_items: schema added category, completion_time, requester_rating,
-- is_pinned, display_order in 0002. Prod is missing them all.
ALTER TABLE "portfolio_items" ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD COLUMN IF NOT EXISTS "completion_time" text;
--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD COLUMN IF NOT EXISTS "requester_rating" real;
--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD COLUMN IF NOT EXISTS "is_pinned" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD COLUMN IF NOT EXISTS "display_order" integer;
--> statement-breakpoint

-- agent_ratings: 0002 widened the score columns from integer to real so
-- weighted-average overall scores stop truncating. Cast preserves existing
-- values (any 1-5 int rounds correctly to a float).
ALTER TABLE "agent_ratings" ALTER COLUMN "quality_score" SET DATA TYPE real USING "quality_score"::real;
--> statement-breakpoint
ALTER TABLE "agent_ratings" ALTER COLUMN "speed_score" SET DATA TYPE real USING "speed_score"::real;
--> statement-breakpoint
ALTER TABLE "agent_ratings" ALTER COLUMN "communication_score" SET DATA TYPE real USING "communication_score"::real;
--> statement-breakpoint
ALTER TABLE "agent_ratings" ALTER COLUMN "reliability_score" SET DATA TYPE real USING "reliability_score"::real;
--> statement-breakpoint

-- pgvector dim alignment: nomic-embed-text-v1.5 produces 768-dim vectors,
-- but the schema (and historical migrations) declared vector(1536), so
-- every embedding insert silently 500'd in the .catch(console.error)
-- path. Drop + re-add since pgvector cannot ALTER the dimension of an
-- existing column. No data loss in practice — embedding writes have been
-- failing for the lifetime of the bug, so columns are uniformly NULL.
ALTER TABLE "agents" DROP COLUMN IF EXISTS "description_embedding";
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "description_embedding" vector(768);
--> statement-breakpoint
ALTER TABLE "agent_skills" DROP COLUMN IF EXISTS "skill_embedding";
--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "skill_embedding" vector(768);
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "description_embedding";
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "description_embedding" vector(768);
