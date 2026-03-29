# Building an autonomous AI agent marketplace

**The infrastructure for an AI-agent-only marketplace — where agents register, list services, transact, and rate each other — already exists in fragments across dozens of platforms.** No single platform combines all the pieces, but the convergence of A2A protocol (150+ organizations), MCP (97M+ monthly SDK downloads), x402 payments (50M+ transactions), and Firecracker sandboxing (Fortune 500 adoption) means you can build this today with production-grade components. This report maps every relevant platform, protocol, and pattern in the landscape, then provides an actionable technical blueprint for assembling them into a functioning agent marketplace.

The timing is uniquely favorable. Moltbook proved (despite its security disasters) that agents will autonomously register and interact at scale — **1.5 million agents signed up in five days**. Meta acquired it for its agent registry potential. Meanwhile, Fetch.ai's Agentverse, Olas's Mech Marketplace, and io.net's Agent Compute demonstrate that agent-to-agent commerce already works. The missing piece is a unified, well-architected platform that combines identity, discovery, task matching, payments, and reputation into a single marketplace experience.

---

## Part 1: The landscape of agent platforms, protocols, and infrastructure

### Moltbook proved the concept — and exposed every vulnerability

Moltbook launched on January 28, 2026, created by Matt Schlicht as a Reddit-style forum exclusively for AI agents. Humans could observe but not post. Within five days, **1.5 million agents registered** — though Wiz researchers later revealed only ~17,000 unique human owners behind them. Meta acquired Moltbook on March 10, 2026, specifically for its agent identity registry potential.

The architecture was remarkably simple. Agents read a `skill.md` file from moltbook.com containing installation instructions, authenticated via their owner's X (Twitter) "claim" tweet, received API credentials, and then operated on a **4-hour heartbeat cycle** — periodically fetching updated instructions and interacting via REST API calls. The backend ran entirely on Supabase (PostgreSQL). Agents were built using **OpenClaw**, the open-source agent framework created by Peter Steinberger.

Moltbook's failures are more instructive than its success. A misconfigured Supabase database exposed **1.5 million API tokens and 35,000 email addresses** with full read/write access. The platform had no mechanism to verify whether a poster was actually an AI agent or a human using cURL. Prompt injection payloads were found embedded in measurable percentages of content. Andrej Karpathy initially called it "one of the most incredible sci-fi takeoff-adjacent things" before revising his assessment to "a dumpster fire." These failures directly inform the security requirements for any serious agent marketplace.

### Five categories of existing agent marketplaces

The current landscape divides into five distinct categories, each solving different parts of the marketplace puzzle.

**Blockchain-native marketplaces** represent the most mature agent-to-agent commerce systems. **Fetch.ai's Agentverse** operates the largest decentralized agent marketplace, built on a Cosmos SDK blockchain with the **Almanac smart contract** serving as an on-chain agent registry (essentially DNS for agents). Agents built with the uAgents Python framework automatically register on the Almanac, which stores addresses, protocols, endpoints, and service metadata. The Open Economic Framework provides peer-to-peer discovery, and agents pay each other in FET tokens for services. **Olas (Autonolas)** runs an even more active agent economy: its Mech Marketplace processes **700,000+ transactions per month** across 9 blockchains, with 2 million of 3.5 million total transactions occurring between agents themselves. Olas agents operate fully on-chain with a "Proof of Active Agent" reward mechanism. **SingularityNET** offers a multi-party escrow system with atomic unidirectional payment channels that minimize gas costs, and stores service metadata on IPFS.

**Framework marketplaces** focus on sharing agent templates and workflows. **CrewAI** operates an enterprise "agentic app store" at marketplace.crewai.com where developers submit crew templates — pre-configured multi-agent systems — for review and distribution. CrewAI reports **1.4 billion agentic automations** and ~450 million agents running monthly across enterprise customers including PwC, IBM, and NVIDIA. **AutoGPT Platform** hosts a catalog of pre-built agent workflows at platform.agpt.co/marketplace with a low-code block-based builder.

**Enterprise cloud marketplaces** from AWS, Google Cloud, Oracle, and Azure now feature dedicated AI agent sections. Google Cloud's marketplace ingests **A2A Agent Cards** for automatic metadata, while AWS supports MCP and A2A protocol filtering integrated with Amazon Bedrock.

**On-chain registries** provide trust infrastructure. The **Solana Agent Registry** (launched March 3, 2026, 9,000+ agents) implements ERC-8004 with three registries — Identity, Reputation, and Validation — at ~0.02 SOL per registration. **ERC-8004** itself launched on Ethereum mainnet on January 29, 2026, with 20,000+ agents deployed across multiple chains within two weeks.

**Open-source platforms** like **IBM's BeeAI/Agent Stack** (contributed to Linux Foundation) provide framework-agnostic infrastructure where agents from LangChain, CrewAI, and AutoGen run on a single platform with automatic A2A protocol exposure.

### A2A and MCP dominate the protocol landscape

The agent communication ecosystem is consolidating rapidly around two primary protocols with complementary roles.

**A2A (Agent-to-Agent Protocol)** is the clear winner for inter-agent communication. Launched by Google at Cloud Next in April 2025, contributed to the Linux Foundation, and now backed by **150+ organizations** including Microsoft, IBM, AWS, Cisco, Salesforce, and SAP. IBM's competing ACP protocol merged into A2A in August 2025 — the strongest signal of ecosystem convergence. A2A uses JSON-RPC 2.0 over HTTPS with gRPC support. Every agent publishes an **Agent Card** at `/.well-known/agent.json` describing capabilities, skills, authentication requirements, and endpoints. Communication is task-oriented: a client sends a message, the server creates a Task with a lifecycle (submitted → working → completed/failed), and outputs are delivered as Artifacts. Authentication supports OAuth 2.0, API keys, and OpenID Connect.

**MCP (Model Context Protocol)** dominates agent-to-tool integration. Created by Anthropic in November 2024 and now governed by the Linux Foundation's Agentic AI Foundation (co-founded with OpenAI and Block), MCP has **10,000+ active public servers** and **97M+ monthly SDK downloads**. It connects agents to external tools, databases, and APIs using a client-server model with JSON-RPC 2.0. MCP is vertical (agent → tools); A2A is horizontal (agent ↔ agent). Both are essential for a marketplace.

**ANP (Agent Network Protocol)** offers the most ambitious decentralized vision, using W3C DIDs for identity, JSON-LD for semantic descriptions, and a three-layer architecture designed for internet-scale agent networks. It's the best option for cross-organizational trust without platform lock-in, but has a much smaller ecosystem than A2A.

Emerging complementary protocols include **AG-UI** (CopilotKit, for agent-to-user interaction, adopted by Microsoft and Google), **x402** (Coinbase/Cloudflare, for agent payments via HTTP 402), **AP2** (for payment authorization with typed mandates), and **UCP** (for standardized commerce operations). The W3C AI Agent Protocol Community Group is working toward official web standards expected in 2026-2027.

### Agent identity is converging on DIDs and cryptographic keypairs

The most actionable approaches for agent identity, ranked by production readiness:

**ERC-8004** provides the most complete on-chain identity system: an Identity Registry (agent "passport"), Reputation Registry (performance scores, uptime, response times), and Validation Registry (cryptographic proof of work completion). Agents need only a blockchain wallet and registry registration. Python libraries via `agent0_sdk` and ElizaOS built-in support make integration straightforward.

**W3C Decentralized Identifiers (DIDs)** with **Verifiable Credentials (VCs)** form the emerging standard for cross-platform agent identity. The v1.1 Working Draft explicitly addresses autonomous AI agents. Combined with VCs, agents can carry portable, cryptographically signed credentials proving capabilities, model version, audit status, and certifications. **KERI (Key Event Receipt Infrastructure)** adds pre-rotation key management without requiring any blockchain.

For enterprise contexts, **Ping Identity** launched "Identity for AI" (GA March 24, 2026) with Agent IAM Core, Agent Gateway, and Agent Detection. **Auth0** leverages OAuth 2.0 with Token Vault for external API tokens. The **Agent Identity Protocol (AIP)** is being proposed to IETF as a universal standard with a Root Registry issuing cryptographic certificates and a Policy Enforcement Proxy verifying Agent Authentication Tokens.

**NIST launched its AI Agent Standards Initiative** in February 2026, signaling government-level urgency around agent identity standardization.

### OpenClaw is the dominant agent framework — with caveats

OpenClaw (formerly Clawdbot/Moltbot), created by Peter Steinberger, is the **fastest-growing open-source project in GitHub history** with ~247,000 stars, beating React's 10-year record in 60 days. Its 5-component architecture — Gateway (WebSocket control plane for 20+ messaging channels), Brain (ReAct reasoning loop), Memory (local Markdown files), Skills (plug-in capabilities), and Heartbeat (autonomous scheduler) — is built in TypeScript/Node.js.

For marketplace purposes, **ClawHub** already functions as a skill marketplace with **5,700+ community-built skills**. An A2A protocol plugin (v0.3.0) enables bidirectional agent communication. Composio integration provides access to 1,000+ third-party tools. Multi-agent routing with isolated sessions is supported natively.

However, OpenClaw has serious security issues: **9+ CVEs in its first two months**, 42,665 exposed instances found by researchers, and Cisco's AI security team discovered a third-party skill performing data exfiltration. NVIDIA released NemoClaw (March 16, 2026) as an enterprise security add-on with OpenShell sandboxing. Any marketplace integrating OpenClaw must add robust sandboxing.

Other frameworks worth integrating: **LangGraph** (production-grade graph-based orchestration, durable execution, 80K+ GitHub stars), **CrewAI** (role-based teams, fastest setup at ~20 lines), **Microsoft Agent Framework** (merger of AutoGen and Semantic Kernel, targeting GA Q1 2026), and **Julep** ("Firebase for AI agents" with Temporal-based workflows).

### Agent compute is becoming autonomous

**io.net** launched **Agent Compute** — the first platform where agents autonomously provision GPU infrastructure using MCP for visibility into specs, costs, and availability. Agents spin up clusters, run workloads, and terminate resources with built-in spending limits. The network spans **327,000 GPUs across 130+ countries** at 70-90% lower cost than traditional cloud.

**Akash Network** operates a Kubernetes-based reverse auction marketplace (tenants set prices, providers bid) at up to **85% lower** cost than traditional cloud. It now offers **one-click OpenClaw deployment** via Akash Agents. **E2B** provides Firecracker microVM sandboxes that boot in ~150ms, used by ~50% of Fortune 500 for executing AI-generated code safely.

---

## Part 2: Technical blueprint for building the marketplace

### Recommended architecture overview

The marketplace should follow a **modular, event-driven microservices architecture** with six core subsystems: Identity & Registry, Discovery & Matching, Communication & Task Management, Payments & Escrow, Compute & Sandboxing, and Reputation & Governance. Each subsystem should be independently deployable and horizontally scalable.

```
┌─────────────────────────────────────────────────────────┐
│                    API Gateway (Kong/Traefik)            │
│              A2A Protocol + REST + WebSocket             │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Identity │ Discovery│  Task    │ Payment  │  Reputation  │
│ Registry │ Matching │ Manager  │ Escrow   │  Engine      │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│              Event Bus (NATS JetStream / Kafka)          │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Sandbox  │ Compute  │  Audit   │  Agent   │  Governance  │
│ Runtime  │ Broker   │  Logger  │  Monitor │  Engine      │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│     PostgreSQL    │   Redis   │  S3/MinIO  │ TimescaleDB  │
└───────────────────┴───────────┴────────────┴─────────────┘
```

### Agent registration and identity system

Use a **hybrid identity model** combining DIDs for cross-platform portability with a local registry for performance.

**Registration flow (fully autonomous, no human required):**
1. Agent generates an **Ed25519 keypair** locally
2. Agent sends a registration request to the marketplace API with its public key, a self-signed DID Document (using `did:web` method anchored to the marketplace domain), and an **Agent Card** (A2A-compliant JSON describing capabilities, skills, input/output modalities)
3. The marketplace issues a **challenge nonce**
4. Agent signs the nonce with its private key and returns it
5. Marketplace verifies the signature, creates the agent's registry entry, issues an **Agent Authentication Token (AAT)** — a JWT with scoped permissions, expiry, and agent DID as subject
6. Agent receives its marketplace ID + AAT

**Identity storage schema (PostgreSQL):**
```sql
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    did TEXT UNIQUE NOT NULL,           -- did:web:marketplace.com:agents:{id}
    public_key BYTEA NOT NULL,          -- Ed25519 public key
    agent_card JSONB NOT NULL,          -- A2A Agent Card
    display_name TEXT,
    owner_did TEXT,                      -- Optional: human owner DID
    status TEXT DEFAULT 'active',       -- active, suspended, banned
    trust_level INT DEFAULT 0,          -- L0-L4
    spending_limit_daily BIGINT,        -- In smallest unit (cents/lamports)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_heartbeat TIMESTAMPTZ
);

CREATE TABLE agent_capabilities (
    agent_id UUID REFERENCES agents(id),
    skill_name TEXT NOT NULL,
    skill_category TEXT NOT NULL,       -- web-design, data-analysis, coding, etc.
    input_modalities TEXT[],            -- text, image, file, structured-data
    output_modalities TEXT[],
    pricing_model TEXT,                 -- per-task, per-hour, per-token
    base_price BIGINT,
    currency TEXT DEFAULT 'USDC',
    benchmark_scores JSONB,            -- Standardized capability benchmarks
    PRIMARY KEY (agent_id, skill_name)
);
```

**Why this approach:** Ed25519 is fast (sign: 87,000/sec, verify: 71,000/sec), compact (32-byte keys), and quantum-resistant plans exist via KERI pre-rotation. `did:web` anchors to your domain for easy resolution without blockchain dependency at launch — you can add `did:ethr` or `did:sol` later for on-chain anchoring. The A2A Agent Card format gives you immediate compatibility with 150+ organizations already supporting the protocol.

### Agent-to-agent communication protocol

**Adopt A2A as the primary protocol.** Every agent in the marketplace must expose an A2A-compliant endpoint. The marketplace itself acts as both an A2A client (dispatching tasks to agents) and provides a discovery layer on top.

**Implementation:**
- Each registered agent gets a marketplace-hosted URL: `https://marketplace.com/agents/{id}/.well-known/agent.json`
- For agents that can't host their own endpoints, the marketplace provides a **proxy relay** — agents poll for incoming messages via WebSocket or long-polling
- Task delegation uses A2A's native lifecycle: `message/send` → Task created → status transitions → Artifacts returned
- Use **NATS JetStream** as the internal message bus (lower latency than Kafka, built-in persistence, perfect for agent messaging patterns)

**For tool access within tasks,** require agents to expose MCP servers for their capabilities. This allows other agents to discover and use specific tools. The marketplace maintains an **MCP Registry** mapping agent capabilities to MCP server endpoints.

```typescript
// Agent Card served at /.well-known/agent.json
{
  "name": "DataAnalysisBot-7x",
  "description": "Statistical analysis, visualization, ML model training",
  "url": "https://marketplace.com/agents/abc123",
  "version": "1.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "statistical-analysis",
      "name": "Statistical Analysis",
      "description": "Regression, hypothesis testing, time-series analysis",
      "inputModes": ["text", "application/json", "text/csv"],
      "outputModes": ["text", "application/json", "image/png"]
    }
  ],
  "authentication": {
    "schemes": ["bearer"],
    "credentials": "marketplace-issued-aat"
  }
}
```

### Task posting, matching, and delegation

The marketplace should support three task-matching patterns:

**1. Direct hiring:** Agent A browses agent profiles, selects Agent B, sends a task directly via A2A. The marketplace facilitates discovery but doesn't orchestrate.

**2. Open task board (reverse auction):** Agent A posts a task with requirements and budget. Matching agents are notified. Interested agents submit bids (price, estimated time, relevant portfolio items). Agent A selects a bidder or the system auto-selects based on reputation-weighted scoring.

**3. Autonomous routing:** Agent A describes a task in natural language. The marketplace's **semantic matching engine** (embedding-based, using pgvector on PostgreSQL or a dedicated vector DB) finds the best-matching agents by skill, price, availability, and reputation. The task is routed automatically.

**Task schema:**
```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID REFERENCES agents(id),
    assignee_id UUID REFERENCES agents(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    skill_requirements TEXT[],
    input_data JSONB,
    budget_max BIGINT,
    currency TEXT DEFAULT 'USDC',
    status TEXT DEFAULT 'open',  -- open, bidding, assigned, in_progress,
                                 -- review, completed, disputed, cancelled
    deadline TIMESTAMPTZ,
    escrow_tx_id TEXT,
    result_artifacts JSONB,
    quality_score FLOAT,         -- Automated quality assessment (0-1)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE task_bids (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks(id),
    bidder_id UUID REFERENCES agents(id),
    price BIGINT,
    estimated_duration INTERVAL,
    confidence_score FLOAT,       -- Agent's self-assessed confidence
    portfolio_refs UUID[],        -- Past relevant completed tasks
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Semantic matching implementation:** Use OpenAI `text-embedding-3-small` (or an open-source model like `bge-large-en-v1.5`) to embed both task descriptions and agent skill descriptions. Store embeddings in **pgvector** and use cosine similarity for matching. Microsoft's research shows that **at least 5 varied sample utterances per agent** dramatically improve retrieval accuracy — require agents to provide these during registration.

### Payment and escrow system

Implement a **dual-rail payment system** supporting both crypto (for speed and autonomy) and fiat (for enterprise adoption).

**Primary rail: x402 protocol (crypto micropayments)**
- Agents hold **USDC on Base** (Coinbase L2) — sub-2-second settlement, near-zero fees
- For each task, the marketplace creates an **escrow smart contract** (pattern from SingularityNET's MPE):
  1. Requester deposits funds into escrow with an expiration block
  2. Assignee performs the task and submits results
  3. Upon verified completion, the marketplace releases funds to assignee
  4. If unresolved by expiration, funds return to requester
- For micropayments (per-API-call pricing), use x402's native flow: agent requests → 402 response with payment instructions → agent pays → receives result

**Secondary rail: Stripe Machine Payments Protocol (fiat)**
- Agents authorize a spending limit upfront via Stripe MPP sessions
- Micropayments stream continuously without per-transaction settlement
- Appears in Stripe Dashboard like normal transactions with full tax/fraud infrastructure

**Wallet architecture:**
- Each agent gets a **Coinbase Agentic Wallet** — enclave-isolated private keys that the LLM never sees
- Programmable guardrails: per-transaction limits, session caps, daily limits
- The marketplace holds a **commission wallet** collecting **5-10% platform fees** per transaction

```typescript
// Escrow contract interface (Solidity-like pseudocode)
interface IAgentEscrow {
    function createEscrow(
        taskId: bytes32,
        requester: address,
        assignee: address,
        amount: uint256,
        expiresAt: uint256
    ) -> bytes32;
    
    function releaseToAssignee(taskId: bytes32, qualityProof: bytes);
    function refundToRequester(taskId: bytes32); // After expiration
    function dispute(taskId: bytes32, evidence: bytes);
}
```

### Task verification and dispute resolution

This is the hardest problem. No production system has fully solved autonomous agent-to-agent dispute resolution. Here's a pragmatic layered approach:

**Layer 1 — Automated quality checks (handles ~80% of tasks):**
- Define **output schemas** per skill category. A data analysis task must return valid JSON with specific fields. A web design task must return valid HTML/CSS that renders correctly.
- Run **deterministic validators**: syntax checking, schema validation, performance benchmarks (page load time, code test pass rate)
- Use a **judge LLM** (separate from the task-performing agent) to assess output quality on a 0-1 scale against the task requirements. Google's research shows centralized orchestrators contain error amplification to **4.4x** versus 17.2x for independent agents.

**Layer 2 — Cryptographic audit trail (for disputed tasks):**
- Every task interaction generates an **immutable log**: task requirements, agent inputs, intermediate outputs, final deliverables, timestamps
- Store hashes on-chain (Base L2), full data in S3/MinIO
- Following Mastercard's Verifiable Intent model: link authorization → execution → outcome in a tamper-resistant record

**Layer 3 — Tribunal system (for unresolvable disputes):**
- Three randomly selected agents with high reputation scores and relevant domain expertise review the evidence
- Majority vote determines outcome
- Tribunal agents earn fees for participation, lose reputation for decisions frequently overturned
- This mirrors the Aegis architecture's "Senatus" model with Byzantine fault tolerance

**Layer 4 — Human escalation (last resort):**
- Tasks above a dollar threshold or with repeated tribunal failures escalate to human arbitrators
- Use a decentralized arbitration service like Kleros or a dedicated marketplace team

### Portfolio and rating system

**Portfolio system:**
- Completed tasks automatically become portfolio items (with requester permission)
- Each portfolio item includes: task description, deliverables, quality score, completion time, requester rating
- Agents can showcase their best work, pinning top items to their profile
- Portfolio data stored in PostgreSQL with file artifacts in S3/MinIO

**Reputation engine (multi-dimensional, inspired by ERC-8004):**
```sql
CREATE TABLE agent_reputation (
    agent_id UUID REFERENCES agents(id),
    dimension TEXT NOT NULL,           -- quality, reliability, speed, communication
    score FLOAT NOT NULL DEFAULT 0.5,  -- 0-1 normalized
    confidence FLOAT NOT NULL,         -- Statistical confidence (increases with more ratings)
    total_ratings INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (agent_id, dimension)
);

CREATE TABLE ratings (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks(id),
    rater_id UUID REFERENCES agents(id),
    ratee_id UUID REFERENCES agents(id),
    dimension TEXT NOT NULL,
    score FLOAT NOT NULL,              -- 0-1
    evidence JSONB,                    -- Automated quality metrics backing the score
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Anti-gaming measures:**
- Ratings are **weighted by the rater's own reputation** — a highly reputed agent's rating counts more
- Detect collusion patterns: mutual high-rating clusters, review bombing, Sybil attacks
- Deploy a **governance agent** that monitors rating distributions for anomalies using statistical process control
- Require a minimum escrow amount per task to prevent free rating farming
- Time-decay: older ratings count less than recent ones

### Sandboxing and security architecture

**Use Firecracker microVMs via E2B for all agent task execution.** This is non-negotiable for a marketplace where untrusted agents execute code.

- Each task execution gets a **dedicated Firecracker microVM** (~150ms boot time, <5 MiB memory overhead)
- Agents cannot access the host system, other agents' sandboxes, or the marketplace infrastructure
- Network isolation: sandboxes communicate only through the marketplace's message bus
- File system: ephemeral by default, with explicit artifact extraction for deliverables
- Time limits: configurable per task, hard kill at deadline
- Resource caps: CPU, memory, disk, network bandwidth limits per sandbox

**Security layers:**
1. **API Gateway** — Rate limiting, DDoS protection, JWT validation
2. **Agent Authentication** — Ed25519 signature verification on every request
3. **Sandbox Isolation** — Firecracker microVMs (kernel-level isolation)
4. **Network Segmentation** — Private networks per sandbox, no inter-sandbox communication except via marketplace APIs
5. **Prompt Injection Defense** — Input sanitization, output filtering, separate system prompts for marketplace operations vs. task execution
6. **Kill Switches** — Automatic shutdown on anomalous behavior (excessive API calls, resource usage spikes, attempted network scanning)

### Recommended tech stack

**Core services (all containerized, deployed on Kubernetes):**

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **API Gateway** | Kong or Traefik | A2A protocol routing, rate limiting, auth |
| **Backend Services** | Node.js (TypeScript) or Go | TypeScript for OpenClaw compatibility; Go for performance-critical services |
| **Primary Database** | PostgreSQL 16 + pgvector | Agent registry, tasks, ratings + vector similarity for matching |
| **Cache/Sessions** | Redis | AAT caching, real-time agent presence, rate limiting |
| **Message Bus** | NATS JetStream | Sub-millisecond latency, persistence, perfect for agent messaging |
| **Time-Series Data** | TimescaleDB | Reputation history, usage metrics, audit logs |
| **Object Storage** | S3 or MinIO | Task artifacts, portfolio files, agent skill packages |
| **Search** | Meilisearch or Typesense | Agent/task discovery with full-text + faceted search |
| **Sandbox Runtime** | E2B (Firecracker) | Per-task isolated execution environments |
| **Payments (Crypto)** | x402 + USDC on Base | Sub-2s settlement, zero protocol fees |
| **Payments (Fiat)** | Stripe MPP | Session-based micropayments, enterprise compatibility |
| **Agent Wallets** | Coinbase CDP (Agentic Wallets) | Enclave-isolated keys, programmable guardrails |
| **Monitoring** | OpenTelemetry + Grafana | Distributed tracing across agent interactions |
| **CI/CD** | GitHub Actions + ArgoCD | GitOps deployment to Kubernetes |
| **Frontend** | Next.js (observer dashboard) | Human observers can browse agents, view portfolios, monitor marketplace |
| **Compute Brokerage** | io.net MCP integration | Agents self-provision GPU when needed |

**Infrastructure:** Deploy on **Fly.io** for the core services (KVM hardware-isolated VMs, per-second billing, global edge) or **Railway/Render** for simpler ops at smaller scale. Use **E2B's hosted sandboxes** initially — self-hosting Firecracker requires significant DevOps investment. For Kubernetes at scale, **DigitalOcean DOKS** or **AWS EKS** with Karpenter for autoscaling.

### Handling agent authentication without human involvement

The system supports three authentication tiers:

**Tier 1 — Fully autonomous (default):** Agent generates keypair, completes challenge-response, receives AAT. No human needed. Trust level starts at L0 (lowest spending limits, limited marketplace access). Trust increases through successful task completion and positive ratings.

**Tier 2 — Owner-verified:** A human owner signs a delegation credential (Verifiable Credential) linking the agent's DID to their own identity. This raises the trust level to L2, unlocking higher spending limits and access to premium task categories. The delegation credential specifies scoped permissions and expiry.

**Tier 3 — Organization-verified:** An organization issues a VC attesting to the agent's provenance, model version, safety audit results, and authorized capabilities. Trust level L3-L4, unlocking the full marketplace with highest spending limits.

All three tiers use the same underlying cryptographic authentication — the difference is the verifiable credentials backing the agent's trust level.

### Scalability design

**Horizontal scaling:** Each core service (registry, matching, task management, payments, reputation) runs as an independent microservice with its own database schema. Scale each independently based on load.

**Agent discovery at scale:** PostgreSQL with pgvector handles semantic search well to ~10M vectors. Beyond that, migrate to a dedicated vector database (Qdrant or Weaviate). Cache hot Agent Cards in Redis with 5-minute TTL.

**Message throughput:** NATS JetStream handles **millions of messages per second** per cluster. Partition by agent region or skill category for further scaling.

**Sandbox scaling:** E2B's hosted platform handles burst scaling automatically. For self-hosted, use a warm pool of pre-booted Firecracker microVMs — snapshot a base image and restore in <50ms.

**Target metrics for launch:** Support **10,000 concurrent agents**, **1,000 tasks/minute**, **sub-200ms API latency** at p99. This is achievable on a single-region deployment with the recommended stack.

### Interoperability with existing frameworks

The marketplace should accept agents from any framework by requiring only A2A compliance:

- **OpenClaw agents** — Use the existing A2A plugin (v0.3.0). Agents register their ClawHub skills as marketplace capabilities.
- **LangGraph agents** — LangChain has native A2A support. Wrap any LangGraph workflow as an A2A endpoint.
- **CrewAI agents** — Each crew member can register independently or a crew can register as a composite agent.
- **Custom agents** — Any HTTP service that publishes an Agent Card at `/.well-known/agent.json` and implements `message/send` is marketplace-compatible.

Provide **SDK wrappers** in Python and TypeScript that handle registration, authentication, task polling, and result submission in ~10 lines of code:

```python
from agentmarket import MarketplaceAgent

agent = MarketplaceAgent(
    name="DataAnalysisBot",
    skills=["statistical-analysis", "data-visualization"],
    pricing={"model": "per-task", "base": 0.50, "currency": "USDC"}
)

@agent.on_task("statistical-analysis")
async def handle_analysis(task):
    # Your agent logic here
    result = await run_analysis(task.input_data)
    return task.complete(artifacts=[result])

agent.start()  # Registers, starts heartbeat, listens for tasks
```

## What to build first

**Phase 1 (Weeks 1-4): Core identity and registry.** Implement agent registration with Ed25519 challenge-response, Agent Card hosting, and a searchable registry. Use PostgreSQL + pgvector. Deploy a basic Next.js dashboard for human observers.

**Phase 2 (Weeks 5-8): Task lifecycle and matching.** Build the task posting, bidding, and assignment system. Implement semantic matching with embeddings. Add NATS JetStream for real-time messaging. Integrate E2B sandboxes for task execution.

**Phase 3 (Weeks 9-12): Payments and reputation.** Integrate x402 with USDC on Base for crypto payments. Add Coinbase Agentic Wallets. Build the multi-dimensional reputation engine with anti-gaming measures. Implement escrow contracts.

**Phase 4 (Weeks 13-16): Polish and launch.** Add the tribunal dispute system, governance agents, portfolio features, compute brokerage via io.net, and framework SDKs. Load test to 10,000 concurrent agents. Security audit.

The market window is open. Moltbook proved demand exists. Fetch.ai and Olas proved agent-to-agent commerce works. The protocols (A2A, MCP, x402) are mature enough for production. The first well-architected, general-purpose agent marketplace that combines identity, discovery, payments, and reputation into a seamless experience will define this category — and the building blocks are all available today.