CREATE TABLE "agent_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"related_task_id" uuid,
	"related_agent_id" uuid,
	"related_skill_id" text,
	"metadata" jsonb,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_endorsements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endorser_id" uuid NOT NULL,
	"endorsee_id" uuid NOT NULL,
	"skill_id" text,
	"title" text NOT NULL,
	"message" text,
	"related_task_id" uuid,
	"verified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_following" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_guilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"founder_id" uuid NOT NULL,
	"avatar_url" text,
	"member_count" integer DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"guild_type" text,
	"min_member_reputation" integer DEFAULT 0 NOT NULL,
	"accepts_new_members" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"sender_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"ratee_id" uuid NOT NULL,
	"quality_score" real NOT NULL,
	"speed_score" real,
	"communication_score" real,
	"reliability_score" real,
	"value_score" real,
	"overall_score" real NOT NULL,
	"evidence" jsonb,
	"comment" text,
	"rater_reputation_at_time" real,
	"weight" real DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_reputation" (
	"agent_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"score" real DEFAULT 0.5 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"total_ratings" integer DEFAULT 0 NOT NULL,
	"recent_trend" real DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"input_modes" text[] DEFAULT '{"text"}' NOT NULL,
	"output_modes" text[] DEFAULT '{"text"}' NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "agent_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"address" text NOT NULL,
	"network" text NOT NULL,
	"encrypted_wallet_data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"did" text NOT NULL,
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
	"premium_tier" text,
	"is_verified_badge" boolean DEFAULT false NOT NULL,
	"webhook_url" text,
	"webhook_secret" text,
	"webhook_events" text[],
	"mcp_endpoint" text,
	"mcp_capabilities" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_heartbeat" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description_embedding" vector(1536),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_did_unique" UNIQUE("did")
);
--> statement-breakpoint
CREATE TABLE "anomaly_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"details" text NOT NULL,
	"action_taken" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" uuid,
	"target_id" uuid,
	"target_type" text,
	"payload" jsonb NOT NULL,
	"hash" text NOT NULL,
	"previous_hash" text
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_key" text NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"raised_by_agent_id" uuid NOT NULL,
	"against_agent_id" uuid,
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
--> statement-breakpoint
CREATE TABLE "escrow_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"payee_id" uuid,
	"amount" bigint NOT NULL,
	"platform_fee" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"escrow_tx_hash" text,
	"release_tx_hash" text,
	"network" text DEFAULT 'base-sepolia' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"target" text NOT NULL,
	"agent_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" text NOT NULL,
	"protocol" text DEFAULT 'mcp' NOT NULL,
	"endpoint" text NOT NULL,
	"tools" jsonb NOT NULL,
	"resources" jsonb,
	"pricing_model" text NOT NULL,
	"price_per_call" bigint,
	"price_per_minute" bigint,
	"subscription_price" bigint,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"category" text NOT NULL,
	"tags" text[],
	"documentation" text,
	"calls_total" bigint DEFAULT 0 NOT NULL,
	"calls_monthly" bigint DEFAULT 0 NOT NULL,
	"revenue_total" bigint DEFAULT 0 NOT NULL,
	"avg_response_time_ms" integer,
	"uptime" real,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mcp_service_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"renews_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"calls_this_month" integer DEFAULT 0 NOT NULL,
	"cost_this_month" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mcp_service_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"arguments" jsonb,
	"result" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"status" text,
	"error" text,
	"cost_usdc" bigint,
	"paid" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" uuid,
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
--> statement-breakpoint
CREATE TABLE "quality_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"schema_validation_passed" boolean,
	"schema_validation_errors" jsonb,
	"schema_validated_at" timestamp with time zone,
	"llm_score" real,
	"llm_reasoning" text,
	"llm_metrics" jsonb,
	"llm_confidence" real,
	"llm_evaluated_at" timestamp with time zone,
	"faithfulness_score" real,
	"faithfulness_details" jsonb,
	"faithfulness_evaluated_at" timestamp with time zone,
	"peer_review_requested" boolean DEFAULT false NOT NULL,
	"peer_reviewers" uuid[],
	"peer_review_score" real,
	"peer_review_votes" jsonb,
	"peer_review_completed_at" timestamp with time zone,
	"final_score" real,
	"final_verdict" text,
	"quality_report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"metric" text NOT NULL,
	"score" real NOT NULL,
	"reasoning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"proposed_price" bigint NOT NULL,
	"confidence_score" real,
	"estimated_duration" text,
	"proposal" text,
	"portfolio_refs" text[],
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"assignee_id" uuid,
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
	"visibility" text DEFAULT 'public' NOT NULL,
	"reveal_identity" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"type" text NOT NULL,
	"from_agent_id" uuid,
	"to_agent_id" uuid,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"tx_hash" text,
	"block_number" bigint,
	"network" text DEFAULT 'base-sepolia',
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_related_task_id_tasks_id_fk" FOREIGN KEY ("related_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_related_agent_id_agents_id_fk" FOREIGN KEY ("related_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_endorsements" ADD CONSTRAINT "agent_endorsements_endorser_id_agents_id_fk" FOREIGN KEY ("endorser_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_endorsements" ADD CONSTRAINT "agent_endorsements_endorsee_id_agents_id_fk" FOREIGN KEY ("endorsee_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_endorsements" ADD CONSTRAINT "agent_endorsements_related_task_id_tasks_id_fk" FOREIGN KEY ("related_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_following" ADD CONSTRAINT "agent_following_follower_id_agents_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_following" ADD CONSTRAINT "agent_following_followee_id_agents_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_guilds" ADD CONSTRAINT "agent_guilds_founder_id_agents_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_recipient_id_agents_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_sender_id_agents_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ratings" ADD CONSTRAINT "agent_ratings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ratings" ADD CONSTRAINT "agent_ratings_rater_id_agents_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ratings" ADD CONSTRAINT "agent_ratings_ratee_id_agents_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reputation" ADD CONSTRAINT "agent_reputation_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_events" ADD CONSTRAINT "anomaly_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_agent_id_agents_id_fk" FOREIGN KEY ("raised_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_against_agent_id_agents_id_fk" FOREIGN KEY ("against_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_payer_id_agents_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_payee_id_agents_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_agent_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."agent_guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_services" ADD CONSTRAINT "mcp_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_subscriptions" ADD CONSTRAINT "mcp_subscriptions_mcp_service_id_mcp_services_id_fk" FOREIGN KEY ("mcp_service_id") REFERENCES "public"."mcp_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_subscriptions" ADD CONSTRAINT "mcp_subscriptions_subscriber_id_agents_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_mcp_service_id_mcp_services_id_fk" FOREIGN KEY ("mcp_service_id") REFERENCES "public"."mcp_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_caller_id_agents_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_submitted_by_agents_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_metrics" ADD CONSTRAINT "quality_metrics_evaluation_id_quality_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."quality_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_bids" ADD CONSTRAINT "task_bids_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_bids" ADD CONSTRAINT "task_bids_bidder_id_agents_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_invitations" ADD CONSTRAINT "task_invitations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_invitations" ADD CONSTRAINT "task_invitations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_requester_id_agents_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_agents_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_agent" ON "agent_activity" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_activity_created" ON "agent_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_type" ON "agent_activity" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_endorsements_endorsee" ON "agent_endorsements" USING btree ("endorsee_id");--> statement-breakpoint
CREATE INDEX "idx_endorsements_endorser" ON "agent_endorsements" USING btree ("endorser_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_following_unique" ON "agent_following" USING btree ("follower_id","followee_id");--> statement-breakpoint
CREATE INDEX "idx_following_follower" ON "agent_following" USING btree ("follower_id");--> statement-breakpoint
CREATE INDEX "idx_following_followee" ON "agent_following" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "idx_agent_messages_recipient" ON "agent_messages" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "idx_agent_messages_unread" ON "agent_messages" USING btree ("recipient_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_unique" ON "agent_ratings" USING btree ("task_id","rater_id");--> statement-breakpoint
CREATE INDEX "idx_ratings_ratee" ON "agent_ratings" USING btree ("ratee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_reputation_pk" ON "agent_reputation" USING btree ("agent_id","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skill_unique" ON "agent_skills" USING btree ("agent_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_wallet_unique" ON "agent_wallets" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_anomaly_events_agent" ON "anomaly_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_anomaly_events_type" ON "anomaly_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_anomaly_events_severity" ON "anomaly_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_audit_timestamp" ON "audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_event_type" ON "audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_challenges_pubkey_used" ON "challenges" USING btree ("public_key","used");--> statement-breakpoint
CREATE INDEX "idx_disputes_status" ON "disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_disputes_task_id" ON "disputes" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_escrow_task_status" ON "escrow_transactions" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "idx_event_outbox_status_created" ON "event_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_member_unique" ON "guild_members" USING btree ("guild_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_services_agent" ON "mcp_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_services_category" ON "mcp_services" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_mcp_services_status" ON "mcp_services" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_subscription_unique" ON "mcp_subscriptions" USING btree ("subscriber_id","mcp_service_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_calls_service" ON "mcp_tool_calls" USING btree ("mcp_service_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_calls_caller" ON "mcp_tool_calls" USING btree ("caller_id");--> statement-breakpoint
CREATE INDEX "idx_portfolio_agent" ON "portfolio_items" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_quality_eval_task" ON "quality_evaluations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_quality_eval_submitted_by" ON "quality_evaluations" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "idx_quality_metrics_eval" ON "quality_metrics" USING btree ("evaluation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_bid_unique" ON "task_bids" USING btree ("task_id","bidder_id");--> statement-breakpoint
CREATE INDEX "idx_task_bids_task_id" ON "task_bids" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_invitation_unique" ON "task_invitations" USING btree ("task_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_task_invitations_task_id" ON "task_invitations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_task_invitations_agent_id" ON "task_invitations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_requester_id" ON "tasks" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_assignee_id" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_task" ON "transactions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_type" ON "transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_transactions_from" ON "transactions" USING btree ("from_agent_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_to" ON "transactions" USING btree ("to_agent_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_status" ON "transactions" USING btree ("status");