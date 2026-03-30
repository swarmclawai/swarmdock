# SwarmRecall — Spec

> Hosted agent persistence layer. Memory, knowledge, learnings, and skills as a service.
> Domain: **swarmrecall.ai**

---

## Origin

SwarmRecall productizes the most popular categories of skills on [ClawHub](https://clawhub.ai) — the agent skill registry with 41k+ published skills. Today these skills all store data locally in flat files that vanish between sessions and can't be shared across agents. SwarmRecall turns them into a hosted API with auth, dashboards, and cross-agent access.

### ClawHub Skills We're Replacing

| Module | ClawHub Skill (reference implementation) | Downloads | What it does locally |
|--------|------------------------------------------|-----------|---------------------|
| **Memory** | [Elite Longterm Memory](https://clawhub.ai/nextfrontierbuilds/elite-longterm-memory) by @nextfrontierbuilds | 43.5k | WAL protocol + vector search + git-notes + SESSION-STATE.md. 5-layer architecture (hot RAM, warm vectors, cold git-notes, curated MEMORY.md, cloud backup). |
| **Memory** | [Memory Manager](https://clawhub.ai/marmikcfc/memory-manager) by @marmikcfc | 18.2k | Compression detection, auto-snapshots, semantic search. Saves context before memory loss. |
| **Memory** | [Agent Memory](https://clawhub.ai/dennis-da-menace/agent-memory) by @dennis-da-menace | 17k | Persistent facts, learn from actions, recall info, track entities across sessions. |
| **Knowledge** | [Ontology](https://clawhub.ai/oswalpalash/ontology) by @oswalpalash | 142k | Typed knowledge graph. Entities (Person, Project, Task, Event, Document), relations, constraints. Append-only graph.jsonl. Python CLI for CRUD + validation. |
| **Learnings** | [self-improving-agent](https://clawhub.ai/pskoett/self-improving-agent) by @pskoett | 326k | #1 skill on ClawHub. Captures learnings, errors, corrections. LEARNINGS.md + ERRORS.md + FEATURE_REQUESTS.md. Promotes recurring patterns. |
| **Learnings** | [Self-Improving + Proactive Agent](https://clawhub.ai/ivangdavila/self-improving-proactive-agent) by @ivangdavila | 130k | Self-reflection + self-criticism + self-learning + self-organizing memory. |
| **Skills** | [Skill Manager](https://clawhub.ai/ivangdavila/skill-manager) by @ivangdavila | 1.8k | Manage installed skills lifecycle: suggest by context, track installations, check updates, cleanup unused. |

### What's Wrong With Local

- **Ephemeral**: Files vanish when session ends or machine resets.
- **Siloed**: Agent A can't access Agent B's knowledge, even if same owner.
- **No search**: Flat markdown files. No vector search, no semantic retrieval, no graph queries.
- **No auth**: Anyone with file access can read/write. No multi-tenant isolation.
- **No dashboard**: Owners can't see what their agents know, learned, or can do.

---

## Architecture

Turborepo monorepo with pnpm workspaces. Mirrors SwarmDock structure exactly.

```
swarmrecall/
├── packages/
│   ├── api/          # Hono backend (port 3300)
│   ├── web/          # Next.js 15 dashboard (port 3400)
│   ├── sdk/          # TypeScript SDK (@swarmrecall/sdk)
│   ├── shared/       # Types, Zod schemas, constants
│   └── cli/          # CLI tool (@swarmrecall/cli)
├── skills/           # ClawHub skill files (thin clients to the API)
│   ├── memory/       # @swarmrecall/memory skill
│   ├── knowledge/    # @swarmrecall/knowledge skill
│   ├── learnings/    # @swarmrecall/learnings skill
│   └── skills/       # @swarmrecall/skills skill
├── docker-compose.yml
├── turbo.json
├── package.json
└── CLAUDE.md
```

### Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| API | Hono | Same as SwarmDock. Port 3300. |
| Database | PostgreSQL 16 + pgvector | 1536-dim embeddings for semantic search |
| Cache | Redis 7 | Rate limiting, session cache |
| Search | Meilisearch | Full-text search over memories, entities, learnings |
| Auth | Firebase Auth | Google/GitHub/email login for dashboard users. Agents auth via API keys. |
| ORM | Drizzle | Type-safe schema, same as SwarmDock |
| Dashboard | Next.js 15 + Tailwind + Radix UI | Same stack as SwarmDock |
| SDK | TypeScript | Namespace pattern matching SwarmDock SDK |
| Deployment | Docker + Vercel (web) | API containerized, web on Vercel |

### Infrastructure (docker-compose.yml)

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  meilisearch:
    image: getmeili/meilisearch:v1.12
    ports: ["7700:7700"]
```

---

## Auth System

Two auth flows:

### 1. Dashboard Auth (Firebase)

For humans managing their agents via the web dashboard.

- Firebase Auth with Google, GitHub, and email/password providers.
- Firebase project: `swarmrecall` (ID: `your-project-id`, created).
- Dashboard uses Firebase JS SDK client-side.
- API verifies Firebase ID tokens server-side via `firebase-admin`.
- Each Firebase user is an "owner" who can have multiple agents.

### 2. Agent Auth (API Keys)

For agents (Claude Code, OpenClaw, etc.) calling the API programmatically.

- Owner creates API keys in the dashboard (scoped per-agent or global).
- API key sent via `Authorization: Bearer sr_live_...` header.
- Keys are hashed (SHA-256) in DB, only shown once on creation.
- Scopes: `memory.read`, `memory.write`, `knowledge.read`, `knowledge.write`, `learnings.read`, `learnings.write`, `skills.read`, `skills.write`.
- Rate limit: 60 req/min per key (sliding window, Redis-backed).

### Linking Agents

An owner can connect multiple agents under their account:

```
Owner (Firebase user)
├── Agent "claude-work" (API key: sr_live_abc...)
│   ├── memories
│   ├── knowledge graph
│   ├── learnings
│   └── installed skills
├── Agent "claude-personal" (API key: sr_live_def...)
│   └── ...
└── Agent "codex-bot" (API key: sr_live_ghi...)
    └── ...
```

Agents can optionally share data across siblings (same owner) via cross-agent queries if the owner enables it.

---

## Database Schema

### Core Tables

```
owners              Firebase users
agents              Registered agents under an owner
api_keys            Hashed API keys with scopes

memories            Fact/context entries with embeddings
memory_sessions     Session boundaries for episodic recall

entities            Typed knowledge graph nodes
relations           Edges between entities
entity_types        Schema/constraint definitions

learnings           Corrections, errors, best practices
learning_patterns   Recurring pattern detection + promotion tracking

agent_skills        Installed skill manifests + configs
skill_overrides     Per-agent customizations

audit_log           All mutations (append-only)
```

### Key Design Decisions

- **All text fields get embeddings** (1536-dim via OpenAI or local model). Enables semantic search across everything.
- **Append-only where possible**. Memories and learnings are never deleted, only archived. Mirrors the append-only graph.jsonl pattern from the Ontology skill.
- **Tenant isolation**. Every query is scoped to `owner_id` + `agent_id`. No cross-tenant leakage.
- **Amounts**: N/A (no payments). This is a utility service, not a marketplace.

---

## Modules

### 1. Memory

**Replaces**: Elite Longterm Memory (43.5k), Memory Manager (18.2k), Agent Memory (17k)

The memory module stores facts, context, session summaries, and preferences with semantic search.

**Concepts from ClawHub skills we're implementing as API:**
- **WAL Protocol** (from Elite Longterm Memory): Write-before-respond pattern. The SDK enforces this — `client.memory.store()` returns before the agent responds.
- **Session State** (from Elite Longterm Memory): Hot context that survives compaction. Maps to a `memory_sessions` table with a `current_state` JSONB column.
- **Compression Detection** (from Memory Manager): API can flag when an agent's active context is approaching limits, triggering auto-snapshot.
- **Semantic Search** (from all three): Vector similarity search via pgvector. `client.memory.search("what CSS framework?")` returns ranked results.
- **Categories** (from Agent Memory): Memories tagged as `fact`, `preference`, `decision`, `context`, `session_summary`.
- **Importance Scoring** (from Elite Longterm Memory): Float 0-1 importance, used for retrieval ranking and auto-archival.

**API Endpoints:**

```
POST   /v1/memory                    # Store a memory
GET    /v1/memory                    # List memories (filtered, paginated)
GET    /v1/memory/search             # Semantic search (vector + keyword)
GET    /v1/memory/:id                # Get single memory
PATCH  /v1/memory/:id                # Update (e.g. importance, archive)
DELETE /v1/memory/:id                # Soft-delete (archive)

POST   /v1/memory/sessions           # Start new session
PATCH  /v1/memory/sessions/:id       # Update session state
GET    /v1/memory/sessions/current    # Get active session state
GET    /v1/memory/sessions            # List past sessions
```

**SDK:**

```typescript
client.memory.store({ content: "User prefers Tailwind", category: "preference", importance: 0.9 })
client.memory.search("CSS framework preferences", { limit: 5, minScore: 0.3 })
client.memory.sessions.start({ context: { task: "Build landing page" } })
client.memory.sessions.current()
```

---

### 2. Knowledge

**Replaces**: Ontology (142k downloads)

The knowledge module stores typed entities, relations, and constraints as a hosted graph.

**Concepts from Ontology skill we're implementing as API:**
- **Entity Types**: Person, Organization, Project, Task, Goal, Event, Location, Document, Message, Thread, Note, Account, Device, Credential, Action, Policy. All from Ontology's core types.
- **Relations**: `has_owner`, `has_task`, `blocks`, `for_event`, etc. With cardinality constraints and acyclicity checks.
- **Schema Constraints**: Required properties, enum validation, forbidden properties (e.g. Credential can't have raw `password`). From Ontology's `schema.yaml`.
- **Append-Only History**: Every mutation logged. Can reconstruct state at any point. Mirrors Ontology's `graph.jsonl`.
- **Graph Traversal**: `client.knowledge.related("proj_001", "has_task")` returns connected entities. Same as Ontology's `related --id proj_001 --rel has_task`.
- **Planning as Graph Transformation**: Multi-step plans modeled as sequences of graph operations, validated before execution. From Ontology's planning patterns.

**API Endpoints:**

```
POST   /v1/knowledge/entities         # Create entity
GET    /v1/knowledge/entities         # List/filter entities
GET    /v1/knowledge/entities/:id     # Get entity with relations
PATCH  /v1/knowledge/entities/:id     # Update entity properties
DELETE /v1/knowledge/entities/:id     # Soft-delete

POST   /v1/knowledge/relations        # Create relation
GET    /v1/knowledge/relations        # List relations (filtered)
DELETE /v1/knowledge/relations/:id    # Remove relation

GET    /v1/knowledge/traverse         # Graph traversal query
GET    /v1/knowledge/search           # Semantic search over entities
POST   /v1/knowledge/validate         # Validate graph constraints

POST   /v1/knowledge/types            # Define/update entity type schema
GET    /v1/knowledge/types            # List type definitions
```

**SDK:**

```typescript
client.knowledge.entities.create({ type: "Person", properties: { name: "Alice", email: "alice@example.com" } })
client.knowledge.relations.create({ from: "proj_001", relation: "has_owner", to: "person_001" })
client.knowledge.traverse({ startId: "proj_001", relation: "has_task", depth: 2 })
client.knowledge.search("website redesign project")
client.knowledge.validate() // Check all constraints
```

---

### 3. Learnings

**Replaces**: self-improving-agent (326k), Self-Improving + Proactive Agent (130k)

The learnings module stores corrections, errors, best practices, and feature requests with pattern detection and promotion.

**Concepts from ClawHub skills we're implementing as API:**
- **Learning Categories** (from self-improving-agent): `correction`, `insight`, `knowledge_gap`, `best_practice`, `error`, `feature_request`.
- **Priority Levels**: `low`, `medium`, `high`, `critical`. From self-improving-agent's priority guidelines.
- **Status Lifecycle**: `pending` → `in_progress` → `resolved` / `wont_fix` / `promoted`. From self-improving-agent's resolution flow.
- **Pattern Detection** (from self-improving-agent): When a new learning is similar to existing ones (vector similarity > 0.85), auto-link with "See Also" and increment recurrence count.
- **Promotion Rules** (from self-improving-agent): When recurrence_count >= 3, seen across 2+ sessions, within 30-day window → flag for promotion. API returns `promotion_candidates` on query.
- **Error Detection** (from self-improving-agent): Structured error entries with command, output, context, suggested fix.
- **Area Tags**: `frontend`, `backend`, `infra`, `tests`, `docs`, `config`. From self-improving-agent.

**API Endpoints:**

```
POST   /v1/learnings                  # Log a learning/error/feature request
GET    /v1/learnings                  # List (filtered by category, status, priority, area)
GET    /v1/learnings/:id              # Get single learning
PATCH  /v1/learnings/:id              # Update status, resolve, promote
GET    /v1/learnings/search           # Semantic search
GET    /v1/learnings/patterns         # Get detected patterns (recurring issues)
GET    /v1/learnings/promotions       # Get promotion candidates
POST   /v1/learnings/:id/link        # Link related learnings (See Also)
```

**SDK:**

```typescript
client.learnings.log({
  category: "correction",
  summary: "pnpm not npm for this project",
  details: "Attempted npm install but failed. Lock file is pnpm-lock.yaml.",
  priority: "high",
  area: "config",
  suggestedAction: "Always use pnpm install"
})
client.learnings.patterns() // Returns recurring patterns with recurrence counts
client.learnings.promotions() // Returns items ready for promotion
client.learnings.resolve("lrn_001", { resolution: "Added to CLAUDE.md", commit: "abc123" })
```

---

### 4. Skills

**Replaces**: Skill Manager (1.8k), general skill tracking needs

The skills module stores an agent's installed capabilities, configurations, and custom overrides.

**Note**: This is NOT a marketplace (that's ClawHub). This stores what a specific agent has installed and how it's configured.

**What we store:**
- **Skill Manifest**: Name, version, source (clawhub slug or git URL), description, triggers, dependencies.
- **Configuration**: Per-agent config overrides (API keys reference, feature flags, custom params).
- **Status**: `active`, `disabled`, `outdated`, `error`.
- **Usage Stats**: Last used, invocation count, error rate.
- **Dependencies**: Which skills depend on which others. Detect conflicts.

**API Endpoints:**

```
POST   /v1/skills                     # Register installed skill
GET    /v1/skills                     # List agent's skills
GET    /v1/skills/:id                 # Get skill details + config
PATCH  /v1/skills/:id                 # Update config/status
DELETE /v1/skills/:id                 # Unregister skill

GET    /v1/skills/suggest             # Suggest skills based on current context/task
GET    /v1/skills/conflicts           # Detect dependency conflicts
POST   /v1/skills/:id/usage          # Report skill usage event
```

**SDK:**

```typescript
client.skills.register({
  name: "self-improving-agent",
  version: "3.0.10",
  source: "clawhub:pskoett/self-improving-agent",
  config: { autoLog: true, promotionThreshold: 3 }
})
client.skills.list({ status: "active" })
client.skills.update("skill_001", { config: { autoLog: false } })
client.skills.suggest("I need to make API calls to Slack") // Returns relevant skills
```

---

## Web Dashboard

Next.js 15 app at `swarmrecall.ai`. Firebase Auth for login.

### Pages

```
/                          # Landing page + login
/dashboard                 # Overview: agent count, memory usage, recent activity
/agents                    # List connected agents
/agents/:id                # Agent detail (memories, knowledge, learnings, skills)
/agents/:id/memory         # Browse/search memories, session history
/agents/:id/knowledge      # Visual graph explorer (entities + relations)
/agents/:id/learnings      # Browse learnings, patterns, promotion queue
/agents/:id/skills         # Installed skills, configs, usage stats
/settings                  # Account, API keys, billing (future)
/settings/api-keys         # Create/revoke API keys
```

### Key Features

- **Graph Visualizer**: Interactive entity-relation graph using D3 or react-force-graph. Click an entity to see all its relations, properties, and connected memories.
- **Memory Timeline**: Chronological view of what the agent learned, with session boundaries marked.
- **Pattern Dashboard**: Recurring learnings with recurrence counts, promotion candidates highlighted.
- **Cross-Agent View**: Toggle to see knowledge/memories across all agents (if owner-level sharing enabled).
- **Semantic Search**: Single search bar that searches across all modules simultaneously.

---

## ClawHub Skills (Thin Clients)

Each module gets published as a separate ClawHub skill. The skills are thin — they contain a SKILL.md that instructs the agent to call the SwarmRecall API instead of writing local files.

### skills/memory/SKILL.md

Instructs agent to:
1. Check for `SWARMRECALL_API_KEY` env var.
2. On session start: `GET /v1/memory/sessions/current` to load hot context.
3. On fact/preference/decision: `POST /v1/memory` with content + category + importance.
4. On recall needed: `GET /v1/memory/search?q=...` for semantic retrieval.
5. On session end: `PATCH /v1/memory/sessions/:id` to save final state.

### skills/knowledge/SKILL.md

Instructs agent to:
1. When user says "remember that..." or provides structured info: `POST /v1/knowledge/entities`.
2. When user asks "what do I know about X?": `GET /v1/knowledge/search?q=X`.
3. When linking concepts: `POST /v1/knowledge/relations`.
4. Periodic: `POST /v1/knowledge/validate` to check constraints.

### skills/learnings/SKILL.md

Instructs agent to:
1. On error: `POST /v1/learnings` with category `error`.
2. On correction: `POST /v1/learnings` with category `correction`.
3. On session start: `GET /v1/learnings/patterns` to preload known issues.
4. On promotion candidates: Surface them to the user for approval.

### skills/skills/SKILL.md

Instructs agent to:
1. On skill install: `POST /v1/skills` to register it.
2. On "what can I do?": `GET /v1/skills` to list capabilities.
3. On task context: `GET /v1/skills/suggest` for relevant skill recommendations.

---

## SDK Design

TypeScript SDK mirroring SwarmDock's namespace pattern.

```typescript
import { SwarmRecallClient } from '@swarmrecall/sdk'

const client = new SwarmRecallClient({
  apiKey: process.env.SWARMRECALL_API_KEY,  // sr_live_...
  baseUrl: 'https://api.swarmrecall.ai'     // default
})

// Memory
client.memory.store(params)
client.memory.search(query, options)
client.memory.sessions.start(params)
client.memory.sessions.current()

// Knowledge
client.knowledge.entities.create(params)
client.knowledge.entities.get(id)
client.knowledge.relations.create(params)
client.knowledge.traverse(params)
client.knowledge.search(query)
client.knowledge.validate()

// Learnings
client.learnings.log(params)
client.learnings.search(query)
client.learnings.patterns()
client.learnings.promotions()
client.learnings.resolve(id, resolution)

// Skills
client.skills.register(params)
client.skills.list(filters)
client.skills.update(id, params)
client.skills.suggest(context)
```

---

## CLI Design

```bash
# Install
npm i -g @swarmrecall/cli

# Auth
swarmrecall login                    # Opens browser for Firebase auth
swarmrecall config set-key sr_live_...  # Set API key for agent use

# Memory
swarmrecall memory store "User prefers dark mode" --category preference --importance 0.9
swarmrecall memory search "CSS framework"
swarmrecall memory sessions list

# Knowledge
swarmrecall knowledge create --type Person --props '{"name":"Alice"}'
swarmrecall knowledge search "project status"
swarmrecall knowledge traverse --from proj_001 --rel has_task

# Learnings
swarmrecall learnings log --category error --summary "npm install failed"
swarmrecall learnings patterns
swarmrecall learnings promotions

# Skills
swarmrecall skills list
swarmrecall skills register --source clawhub:pskoett/self-improving-agent
```

---

## Environment Variables

```bash
# Core
DATABASE_URL=postgresql://user:pass@localhost:5432/swarmrecall
REDIS_URL=redis://localhost:6379
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_API_KEY=masterKey

# Firebase (server-side admin)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Firebase (client-side, web dashboard)
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-firebase-app-id
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your-measurement-id

# Embeddings
OPENAI_API_KEY=sk-...              # For generating embeddings (or use local model)
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# API
PORT=3300
JWT_SECRET=...                      # For signing agent session tokens
CORS_ORIGINS=https://swarmrecall.ai,http://localhost:3400

# Rate Limiting
RATE_LIMIT_DEFAULT=60              # req/min per API key
RATE_LIMIT_SEARCH=30               # req/min for search endpoints (heavier)
```

---

## Development

```bash
# Start infrastructure
docker-compose up -d

# Install deps
pnpm install

# Push schema
pnpm --filter @swarmrecall/api db:push

# Seed test data
pnpm --filter @swarmrecall/api db:seed

# Start all packages
pnpm dev
```

- API: http://localhost:3300
- Dashboard: http://localhost:3400
- Meilisearch: http://localhost:7700

---

## Relationship to SwarmDock

SwarmRecall is a **sibling service**, not a sub-module of SwarmDock.

- **SwarmDock** = where agents find work and get paid (marketplace).
- **SwarmRecall** = where agents persist what they know (state layer).
- **SwarmClaw** = agent runtime and control plane.

An agent on SwarmDock can use SwarmRecall to:
1. Pull relevant knowledge before starting a task.
2. Store learnings from completed tasks.
3. Build up a knowledge graph of project context across multiple tasks.
4. Carry installed skills and preferences from job to job.

Future: SwarmDock's `agent_skills` table could sync with SwarmRecall's skills module, and SwarmDock's reputation ratings could feed into SwarmRecall's learnings.

---

## Next Steps

1. ~~Write spec~~ (this document)
2. ~~Create Firebase project~~ (project: `your-project-id`, auth: Email/Password + Google enabled, GitHub pending OAuth app)
3. Scaffold monorepo (mirror SwarmDock structure)
4. Implement database schema (Drizzle)
5. Build API routes (Hono)
6. Build SDK
7. Build dashboard
8. Publish ClawHub skills
9. Deploy
