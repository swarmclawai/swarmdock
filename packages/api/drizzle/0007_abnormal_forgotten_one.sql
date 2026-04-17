CREATE TABLE "mcp_server_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"method" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_server_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"usage_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_server_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"input_schema" jsonb,
	"tool_embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"homepage" text,
	"repo_url" text,
	"license" text,
	"transport" text NOT NULL,
	"auth_mode" text DEFAULT 'none' NOT NULL,
	"language" text,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"ingested_from" text[] DEFAULT '{}' NOT NULL,
	"upstream_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_score" real DEFAULT 0 NOT NULL,
	"verified_usage_count" integer DEFAULT 0 NOT NULL,
	"submitted_by_agent_id" uuid,
	"paid_tier" boolean DEFAULT false NOT NULL,
	"price_micro_usdc" bigint,
	"payout_address" text,
	"description_embedding" vector(768),
	"last_crawled_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_did" text NOT NULL,
	"task_id" uuid,
	"outcome" text NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"tool_name" text,
	"signature" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_server_installations" ADD CONSTRAINT "mcp_server_installations_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_ratings" ADD CONSTRAINT "mcp_server_ratings_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_ratings" ADD CONSTRAINT "mcp_server_ratings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_ratings" ADD CONSTRAINT "mcp_server_ratings_usage_event_id_mcp_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."mcp_usage_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_tools" ADD CONSTRAINT "mcp_server_tools_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_submitted_by_agent_id_agents_id_fk" FOREIGN KEY ("submitted_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_usage_events" ADD CONSTRAINT "mcp_usage_events_server_id_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_usage_events" ADD CONSTRAINT "mcp_usage_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_usage_events" ADD CONSTRAINT "mcp_usage_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_server_installations_server_idx" ON "mcp_server_installations" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_ratings_agent_server_idx" ON "mcp_server_ratings" USING btree ("agent_id","server_id");--> statement-breakpoint
CREATE INDEX "mcp_server_ratings_server_idx" ON "mcp_server_ratings" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_tools_server_name_idx" ON "mcp_server_tools" USING btree ("server_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_slug_idx" ON "mcp_servers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "mcp_servers_quality_idx" ON "mcp_servers" USING btree ("quality_score");--> statement-breakpoint
CREATE INDEX "mcp_servers_transport_idx" ON "mcp_servers" USING btree ("transport");--> statement-breakpoint
CREATE INDEX "mcp_usage_events_server_idx" ON "mcp_usage_events" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "mcp_usage_events_agent_idx" ON "mcp_usage_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "mcp_usage_events_outcome_idx" ON "mcp_usage_events" USING btree ("outcome");