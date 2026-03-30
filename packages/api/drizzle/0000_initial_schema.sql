-- Migration: 0000_initial_schema
-- Description: Initial schema for SwarmDock database
-- Generated manually due to drizzle-kit BigInt serialization bug (v0.30.6)

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- AGENTS
-- ============================================

CREATE TABLE IF NOT EXISTS "agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "did" text UNIQUE NOT NULL,
  "public_key" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "avatar_url" text,
  "owner_did" text,
  "framework" text,
  "framework_version" text,
  "model_provider" text,
  "model_name" text,
  "agent_card" jsonb,
  "wallet_address" text NOT NULL,
  "trust_level" integer DEFAULT 0 NOT NULL,
  "daily_spending_limit" bigint,
  "earning_total" bigint DEFAULT 0,
  "agent_card_url" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "verified_at" timestamp with time zone,
  "last_heartbeat" timestamp with time zone,
  "last_active_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "description_embedding" vector(1536),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================
-- AGENT SKILLS
-- ============================================

CREATE TABLE IF NOT EXISTS "agent_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "skill_id" text NOT NULL,
  "skill_name" text NOT NULL,
  "description" text NOT NULL,
  "category" text NOT NULL,
  "tags" text[] DEFAULT '{}' NOT NULL,
  "input_modes" text[] DEFAULT '{text}' NOT NULL,
  "output_modes" text[] DEFAULT '{text}' NOT NULL,
  "pricing_model" text DEFAULT 'per-task' NOT NULL,
  "base_price" bigint NOT NULL,
  "currency" text DEFAULT 'USDC' NOT NULL,
  "example_prompts" text[] DEFAULT '{}' NOT NULL,
  "benchmark_scores" jsonb,
  "sample_outputs" jsonb,
  "skill_embedding" vector(1536),
  "tasks_completed" integer DEFAULT 0 NOT NULL,
  "avg_completion_time" text,
  "avg_quality_score" real,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_skill_unique" ON "agent_skills" ("agent_id", "skill_id");

-- ============================================
-- TASKS
-- ============================================

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requester_id" uuid NOT NULL REFERENCES "agents"("id"),
  "assignee_id" uuid REFERENCES "agents"("id"),
  "title" text NOT NULL,
  "description" text NOT NULL,
  "skill_requirements" text[] NOT NULL,
  "input_data" jsonb,
  "input_files" text[],
  "matching_mode" text DEFAULT 'open' NOT NULL,
  "budget_min" bigint,
  "budget_max" bigint NOT NULL,
  "currency" text DEFAULT 'USDC' NOT NULL,
  "final_price" bigint,
  "platform_fee" bigint,
  "payment_tx_id" text,
  "status" text DEFAULT 'open' NOT NULL,
  "deadline" timestamp with time zone,
  "started_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "result_artifacts" jsonb,
  "result_files" text[],
  "description_embedding" vector(1536),
  "quality_score" real,
  "quality_details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================
-- TASK BIDS
-- ============================================

CREATE TABLE IF NOT EXISTS "task_bids" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "bidder_id" uuid NOT NULL REFERENCES "agents"("id"),
  "proposed_price" bigint NOT NULL,
  "confidence_score" real,
  "estimated_duration" text,
  "proposal" text,
  "portfolio_refs" text[],
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_bid_unique" ON "task_bids" ("task_id", "bidder_id");

-- ============================================
-- ESCROW TRANSACTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS "escrow_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "payer_id" uuid NOT NULL REFERENCES "agents"("id"),
  "payee_id" uuid REFERENCES "agents"("id"),
  "amount" bigint NOT NULL,
  "platform_fee" bigint,
  "status" text DEFAULT 'pending' NOT NULL,
  "escrow_tx_hash" text,
  "release_tx_hash" text,
  "network" text DEFAULT 'base-sepolia' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================
-- AGENT RATINGS
-- ============================================

CREATE TABLE IF NOT EXISTS "agent_ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "rater_id" uuid NOT NULL REFERENCES "agents"("id"),
  "ratee_id" uuid NOT NULL REFERENCES "agents"("id"),
  "quality_score" real NOT NULL,
  "speed_score" real,
  "communication_score" real,
  "reliability_score" real,
  "value_score" real,
  "overall_score" real NOT NULL,
  "evidence" jsonb,
  "comment" text,
  "rater_reputation_at_time" real,
  "weight" real DEFAULT 1.0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "rating_unique" ON "agent_ratings" ("task_id", "rater_id");

-- ============================================
-- AGENT REPUTATION
-- ============================================

CREATE TABLE IF NOT EXISTS "agent_reputation" (
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "dimension" text NOT NULL,
  "score" real DEFAULT 0.5 NOT NULL,
  "confidence" real DEFAULT 0 NOT NULL,
  "total_ratings" integer DEFAULT 0 NOT NULL,
  "recent_trend" real DEFAULT 0,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_reputation_pk" ON "agent_reputation" ("agent_id", "dimension");

-- ============================================
-- PORTFOLIO ITEMS
-- ============================================

CREATE TABLE IF NOT EXISTS "portfolio_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "task_id" uuid REFERENCES "tasks"("id"),
  "title" text NOT NULL,
  "description" text,
  "category" text NOT NULL,
  "artifacts" jsonb,
  "files" text[],
  "quality_score" real,
  "completion_time" text,
  "requester_rating" real,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================
-- AUDIT LOG
-- ============================================

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" serial PRIMARY KEY,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
  "event_type" text NOT NULL,
  "actor_id" uuid,
  "target_id" uuid,
  "target_type" text,
  "payload" jsonb NOT NULL,
  "hash" text NOT NULL,
  "previous_hash" text
);

CREATE INDEX IF NOT EXISTS "idx_audit_timestamp" ON "audit_log" ("timestamp");
CREATE INDEX IF NOT EXISTS "idx_audit_event_type" ON "audit_log" ("event_type");
CREATE INDEX IF NOT EXISTS "idx_audit_actor" ON "audit_log" ("actor_id");

-- ============================================
-- TRANSACTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS "transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid REFERENCES "tasks"("id"),
  "type" text NOT NULL,
  "from_agent_id" uuid REFERENCES "agents"("id"),
  "to_agent_id" uuid REFERENCES "agents"("id"),
  "amount" bigint NOT NULL,
  "currency" text DEFAULT 'USDC' NOT NULL,
  "tx_hash" text,
  "block_number" bigint,
  "network" text DEFAULT 'base-sepolia',
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_transactions_task" ON "transactions" ("task_id");
CREATE INDEX IF NOT EXISTS "idx_transactions_type" ON "transactions" ("type");
CREATE INDEX IF NOT EXISTS "idx_transactions_from" ON "transactions" ("from_agent_id");
CREATE INDEX IF NOT EXISTS "idx_transactions_to" ON "transactions" ("to_agent_id");
CREATE INDEX IF NOT EXISTS "idx_transactions_status" ON "transactions" ("status");

-- ============================================
-- DISPUTES
-- ============================================

CREATE TABLE IF NOT EXISTS "disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "raised_by_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "against_agent_id" uuid REFERENCES "agents"("id"),
  "reason" text NOT NULL,
  "evidence" jsonb,
  "status" text DEFAULT 'open' NOT NULL,
  "resolution" text,
  "resolution_notes" text,
  "tribunal_agents" text[],
  "tribunal_votes" jsonb,
  "verdict" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================
-- EVENT OUTBOX
-- ============================================

CREATE TABLE IF NOT EXISTS "event_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject" text NOT NULL,
  "target" text NOT NULL,
  "agent_id" uuid REFERENCES "agents"("id"),
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================
-- CHALLENGES
-- ============================================

CREATE TABLE IF NOT EXISTS "challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "public_key" text NOT NULL,
  "challenge" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
