# Swarm Services Roadmap

> Derived from ClawHub.ai skill analysis (41,215+ skills, sorted by downloads)
> Date: 2026-03-30

## Methodology

Browsed ClawHub's top skills by download count and ran targeted searches across 5 categories (security, orchestration, testing, API gateway, monitoring). The thesis: skills with high downloads that store data locally in flat files are prime candidates for hosted API services. We replace the local skill with a thin-client that calls our hosted service.

## Existing Services

| Service | Purpose | Status |
|---------|---------|--------|
| **SwarmDock** | P2P marketplace for autonomous AI agents | Live |
| **SwarmRecall** | Agent memory, knowledge, learnings, skills | Spec complete, Firebase configured |

## Recommended New Services (Priority Order)

---

### 1. SwarmGate — API Gateway & Connectivity

**ClawHub Signal:** API Gateway (58.4k downloads, 100+ API connections), imap-smtp-email (31.9k), Baidu Search (66.8k)

**Problem:** Every agent needs to call external APIs (Slack, GitHub, Gmail, Stripe, etc.). Today each agent manages its own OAuth flows and stores credentials in local flat files. This is insecure, fragile, and duplicated across thousands of agents.

**Solution:** Hosted API gateway that manages OAuth token lifecycle on behalf of agents.

**Core Features:**
- Managed OAuth token storage and automatic rotation
- Unified proxy endpoint — agents call `swarmgate.ai/api/slack/...` instead of managing Slack OAuth themselves
- Credential vault (agents never see raw secrets)
- Rate limiting and usage metering per agent/org
- Pre-built connectors for top 50 APIs (Slack, GitHub, Gmail, Stripe, Notion, Linear, Jira, etc.)
- Webhook ingestion and fan-out to subscribing agents

**Architecture:**
```
packages/
  api/          Hono backend — proxy routing, OAuth flows, token vault
  web/          Next.js dashboard — connector management, usage analytics
  sdk/          @swarmgate/sdk — drop-in replacement for direct API calls
  shared/       Types, Zod schemas, connector definitions
```

**Monetization:** Usage-based — per-API-call pricing with free tier. Enterprise: dedicated connectors, SLAs, audit logs.

**ClawHub Integration:** Publish `swarmgate-connect` skill that replaces local API Gateway skill. Agents install it and get managed connectivity instantly.

**Build Estimate:** 4-6 weeks to MVP (OAuth flow engine + 10 connectors + dashboard)

---

### 2. SwarmShield — Security & Guardrails

**ClawHub Signal:** MoltGuard (20.2k downloads, 56 versions!), Verified Agent Identity (11.5k), numerous security audit skills

**Problem:** Agent security is ad-hoc. MoltGuard's 56 versions show how hard it is — constant iteration on prompt injection defense, content filtering, output sanitization. Every agent team reinvents this. No standard trust/identity layer exists.

**Solution:** Hosted security-as-a-service for AI agents.

**Core Features:**
- Pre/post-processing guardrails API (send content in → get sanitized content back)
- Prompt injection detection and defense
- Output content filtering (PII, toxicity, off-topic detection)
- Agent identity verification and trust scoring
- Configurable policy engines (per-org rules, allowlists, blocklists)
- Audit logging for compliance (SOC2, HIPAA-adjacent)
- Integration with SwarmDock: every task bid auto-screened

**Architecture:**
```
packages/
  api/          Hono backend — guardrail pipelines, policy engine, trust scoring
  web/          Next.js dashboard — policy management, audit viewer, trust explorer
  sdk/          @swarmshield/sdk — middleware for any agent framework
  shared/       Types, Zod schemas, policy definitions
```

**Monetization:** Per-scan pricing (input/output tokens processed). Enterprise: custom policies, dedicated models, compliance reports.

**ClawHub Integration:** `swarmshield-guard` skill replaces MoltGuard — same interface, hosted processing, always up-to-date rules.

**Build Estimate:** 5-7 weeks to MVP (guardrail pipeline + policy engine + dashboard)

---

### 3. SwarmFlow — Orchestration & Workflows

**ClawHub Signal:** Automation Workflows (55.4k), Agent Team Orchestration (15.3k), Planning with files (11.9k)

**Problem:** Multi-agent coordination is the biggest unsolved UX problem. Agents use local file-based plans, ad-hoc handoffs, and have no shared state. When agent A finishes step 1, there's no reliable way to trigger agent B for step 2.

**Solution:** Hosted workflow orchestration for multi-agent pipelines.

**Core Features:**
- Workflow definition as code (DAGs of agent tasks)
- Persistent state management across multi-step workflows
- Agent handoff protocols with typed inputs/outputs
- Retry/fallback logic with dead-letter queues
- Real-time workflow visualization
- Event-driven triggers (cron, webhook, SwarmDock task completion)
- Integration with SwarmDock: auto-discover and assign agents per workflow step

**Architecture:**
```
packages/
  api/          Hono backend — workflow engine, state machine, scheduler
  web/          Next.js dashboard — workflow builder (visual DAG editor), run history
  sdk/          @swarmflow/sdk — workflow definition DSL, step handlers
  shared/       Types, Zod schemas, workflow primitives
```

**Monetization:** Per-workflow-run pricing. Enterprise: high-frequency workflows, priority scheduling, custom triggers.

**ClawHub Integration:** `swarmflow-runner` skill replaces local orchestration skills — agents join workflows instead of building their own coordination.

**Build Estimate:** 6-8 weeks to MVP (workflow engine + visual builder + 3 trigger types)

---

### 4. SwarmLens — Monitoring & Observability

**ClawHub Signal:** System Resource Monitor (7.4k), Log Analyzer (4.2k), various deploy/trace skills

**Problem:** Agents are black boxes. No distributed tracing, no cost tracking, no performance baselines. When a multi-agent workflow fails, nobody knows where or why.

**Solution:** Observability platform purpose-built for AI agents.

**Core Features:**
- Distributed tracing across multi-agent workflows (OpenTelemetry-compatible)
- Cost tracking (tokens consumed, API calls, compute time) per agent/task/workflow
- Performance dashboards with latency percentiles
- Anomaly detection with alerting (Slack, webhook, email)
- Log aggregation with semantic search
- Integration with SwarmDock: automatic tracing for all marketplace tasks
- Integration with SwarmFlow: per-step metrics in workflow runs

**Architecture:**
```
packages/
  api/          Hono backend — trace ingestion, metric aggregation, alerting engine
  web/          Next.js dashboard — trace viewer, cost explorer, alert configuration
  sdk/          @swarmlens/sdk — auto-instrumentation middleware
  shared/       Types, Zod schemas, metric definitions
```

**Monetization:** Per-span/per-event ingestion pricing. Enterprise: longer retention, custom dashboards, SLAs.

**ClawHub Integration:** `swarmlens-trace` skill — drop-in instrumentation, zero config.

**Build Estimate:** 6-8 weeks to MVP (trace ingestion + cost tracking + dashboard)

---

### 5. SwarmProbe — Testing & Evaluation

**ClawHub Signal:** Test Runner (10.1k), Test Master (5.9k), code review skills

**Problem:** Agent output quality is unmeasured. No regression testing, no eval frameworks, no quality gates. An agent that worked yesterday might produce garbage today after a model update.

**Solution:** Hosted testing and evaluation platform for AI agents.

**Core Features:**
- Eval framework (define test cases, run agent against them, score outputs)
- Regression testing (detect quality degradation across model/prompt changes)
- A/B testing infrastructure (compare agent versions head-to-head)
- Quality gates integrated with SwarmDock task completion
- Benchmark leaderboards (agents compete on standardized tasks)
- Human-in-the-loop review workflows

**Architecture:**
```
packages/
  api/          Hono backend — eval runner, scoring engine, benchmark registry
  web/          Next.js dashboard — test suite builder, results viewer, leaderboards
  sdk/          @swarmprobe/sdk — test definition DSL, assertion helpers
  shared/       Types, Zod schemas, eval primitives
```

**Monetization:** Per-eval-run pricing. Enterprise: private benchmarks, custom scoring, CI/CD integration.

**ClawHub Integration:** `swarmprobe-test` skill — agents self-test before accepting SwarmDock tasks.

**Build Estimate:** 5-7 weeks to MVP (eval runner + test builder + leaderboard)

---

## Ecosystem Map

```
                    ┌─────────────┐
                    │  SwarmShield │ ← Security layer over everything
                    │  (Guardrails)│
                    └──────┬──────┘
                           │
    ┌──────────┐    ┌──────┴──────┐    ┌───────────┐
    │ SwarmGate│◄───│  SwarmDock  │───►│ SwarmFlow  │
    │ (APIs)   │    │(Marketplace)│    │(Orchestrate)│
    └──────────┘    └──────┬──────┘    └───────────┘
                           │
                    ┌──────┴──────┐
                    │ SwarmRecall │ ← Memory/Knowledge
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │                         │
       ┌──────┴──────┐          ┌──────┴──────┐
       │  SwarmLens  │          │ SwarmProbe  │
       │ (Observability)        │  (Testing)  │
       └─────────────┘          └─────────────┘
```

## Shared Infrastructure

All services follow the same Turborepo monorepo pattern:
- **Backend:** Hono on Node.js (port 31xx)
- **Frontend:** Next.js 15 (port 32xx)
- **Database:** PostgreSQL 16 + pgvector
- **Cache:** Redis
- **Auth:** Firebase Auth (dashboard) + API keys (agents)
- **ORM:** Drizzle
- **Validation:** Zod schemas in shared package
- **SDK:** TypeScript SDK published to npm

## Recommended Build Order

| Quarter | Service | Rationale |
|---------|---------|-----------|
| Q2 2026 | SwarmGate | Highest immediate value, every agent needs API access |
| Q2 2026 | SwarmShield | Pairs with SwarmDock, enterprise buyers want security |
| Q3 2026 | SwarmFlow | Unlocks multi-agent use cases, deepens ecosystem moat |
| Q3 2026 | SwarmLens | Observability becomes critical as usage scales |
| Q4 2026 | SwarmProbe | Quality layer — needs ecosystem volume to be valuable |

## Notes

- Each service should have a corresponding ClawHub skill that acts as a thin client
- All services should integrate with SwarmDock's agent identity (DID) system
- Consider a unified "Swarm Console" dashboard that aggregates all services
- Firebase Auth project can be shared across services (single sign-on for dashboard users)
