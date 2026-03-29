import { Hono } from 'hono';
import { db } from '../db/client.js';
import { agents, agentSkills, challenges } from '../db/schema.js';
import { eq, and, lt, inArray, sql } from 'drizzle-orm';
import { generateChallenge, verifySignature, generateDID } from '../lib/crypto.js';
import { issueAAT } from '../services/identity.js';
import { embed, embedBatch } from '../services/embeddings.js';
import { AgentRegisterSchema, AgentVerifySchema, AgentUpdateSchema, AGENT_STATUS } from '@swarmdock/shared';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { eventBus } from '../lib/events.js';

const app = new Hono<AuthContext>();

// POST /api/v1/agents/register — Start registration, return challenge
app.post('/register', async (c) => {
  const body = await c.req.json();
  const parsed = AgentRegisterSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { publicKey, displayName, description, framework, frameworkVersion, modelProvider, modelName, walletAddress, agentCardUrl, skills } = parsed.data;

  // Check if agent already exists with this public key
  const existing = await db.select().from(agents).where(eq(agents.publicKey, publicKey)).limit(1);
  if (existing.length > 0 && existing[0].status === AGENT_STATUS.ACTIVE) {
    return c.json({ error: 'Agent with this public key already registered' }, 409);
  }

  // Generate challenge
  const { challenge, expiresAt } = generateChallenge();

  // Store challenge
  await db.insert(challenges).values({
    publicKey,
    challenge,
    expiresAt,
  });

  // Store pending agent (will be activated after verification)
  let agentId: string;
  if (existing.length > 0) {
    agentId = existing[0].id;
    await db.update(agents).set({
      displayName, description, framework, frameworkVersion, modelProvider, modelName, walletAddress, agentCardUrl,
      status: AGENT_STATUS.PENDING,
      updatedAt: new Date(),
    }).where(eq(agents.id, agentId));
  } else {
    const tempDid = `did:web:swarmdock.ai:agents:pending`;
    const [agent] = await db.insert(agents).values({
      did: tempDid,
      publicKey, displayName, description, framework, frameworkVersion, modelProvider, modelName, walletAddress, agentCardUrl,
      status: AGENT_STATUS.PENDING,
    }).returning();
    agentId = agent.id;

    // Update DID with actual agent ID
    const did = generateDID(agentId);
    await db.update(agents).set({ did }).where(eq(agents.id, agentId));

    // Insert skills
    if (skills.length > 0) {
      await db.insert(agentSkills).values(
        skills.map((s) => ({
          agentId,
          skillId: s.skillId,
          skillName: s.skillName,
          description: s.description,
          category: s.category,
          tags: s.tags,
          pricingModel: s.pricingModel,
          basePrice: BigInt(s.basePrice),
          examplePrompts: s.examplePrompts,
        })),
      );
    }
  }

  // Async embed agent description and skills (don't block response)
  if (description) {
    embed(description).then(async (vec) => {
      await db.update(agents).set({ descriptionEmbedding: vec }).where(eq(agents.id, agentId));
    }).catch(console.error);
  }
  if (skills.length > 0) {
    embedBatch(skills.map((s) => s.description)).then(async (vecs) => {
      const skillRows = await db.select().from(agentSkills).where(eq(agentSkills.agentId, agentId));
      await Promise.all(
        skillRows.map((row, i) =>
          db.update(agentSkills).set({ skillEmbedding: vecs[i] }).where(eq(agentSkills.id, row.id)),
        ),
      );
    }).catch(console.error);
  }

  return c.json({
    agentId,
    challenge,
    expiresAt: expiresAt.toISOString(),
  }, 201);
});

// POST /api/v1/agents/verify — Complete challenge-response, issue AAT
app.post('/verify', async (c) => {
  const body = await c.req.json();
  const parsed = AgentVerifySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { publicKey, challenge, signature } = parsed.data;

  // Find valid challenge
  const [storedChallenge] = await db
    .select()
    .from(challenges)
    .where(
      and(
        eq(challenges.publicKey, publicKey),
        eq(challenges.challenge, challenge),
        eq(challenges.used, false),
      ),
    )
    .limit(1);

  if (!storedChallenge) {
    return c.json({ error: 'Challenge not found or already used' }, 400);
  }

  if (new Date() > storedChallenge.expiresAt) {
    return c.json({ error: 'Challenge expired' }, 400);
  }

  // Verify signature
  if (!verifySignature(publicKey, challenge, signature)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // Mark challenge as used
  await db.update(challenges).set({ used: true }).where(eq(challenges.id, storedChallenge.id));

  // Activate agent
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.publicKey, publicKey))
    .limit(1);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  await db.update(agents).set({
    status: AGENT_STATUS.ACTIVE,
    trustLevel: 2, // L2: Challenge completed
    lastHeartbeat: new Date(),
    updatedAt: new Date(),
  }).where(eq(agents.id, agent.id));

  // Issue AAT
  const token = await issueAAT({
    id: agent.id,
    did: agent.did,
    trustLevel: 2,
  });

  eventBus.broadcast({
    type: 'agent.registered',
    data: { agentId: agent.id, did: agent.did, displayName: agent.displayName },
  });

  return c.json({
    token,
    agent: {
      id: agent.id,
      did: agent.did,
      displayName: agent.displayName,
      trustLevel: 2,
      status: AGENT_STATUS.ACTIVE,
    },
  });
});

// GET /api/v1/agents/:id — Public agent profile
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

  if (!agent || agent.status === AGENT_STATUS.DEREGISTERED) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const skills = await db.select().from(agentSkills).where(eq(agentSkills.agentId, id));

  return c.json({
    ...agent,
    publicKey: undefined, // Don't expose raw public key in profile
    skills,
  });
});

// GET /api/v1/agents — List agents (with optional skill filter)
app.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const skillsParam = c.req.query('skills');

  if (skillsParam) {
    // Filter agents by matching skills
    const skillList = skillsParam.split(',').map((s) => s.trim().toLowerCase());
    const matchingAgentIds = await db
      .selectDistinct({ agentId: agentSkills.agentId })
      .from(agentSkills)
      .where(sql`LOWER(${agentSkills.skillId}) = ANY(${skillList})`);

    if (matchingAgentIds.length === 0) {
      return c.json({ agents: [], limit, offset });
    }

    const ids = matchingAgentIds.map((r) => r.agentId);
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.status, AGENT_STATUS.ACTIVE), inArray(agents.id, ids)))
      .limit(Math.min(limit, 100))
      .offset(offset);

    return c.json({ agents: result, limit, offset });
  }

  const result = await db
    .select()
    .from(agents)
    .where(eq(agents.status, AGENT_STATUS.ACTIVE))
    .limit(Math.min(limit, 100))
    .offset(offset);

  return c.json({ agents: result, limit, offset });
});

// PATCH /api/v1/agents/:id — Update own profile (auth required)
app.patch('/:id', authMiddleware, requireScope('profile.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  if (agent.agent_id !== id) {
    return c.json({ error: 'Can only update your own profile' }, 403);
  }

  const body = await c.req.json();
  const parsed = AgentUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.dailySpendingLimit !== undefined) {
    updateData.dailySpendingLimit = BigInt(parsed.data.dailySpendingLimit);
  }

  const [updated] = await db
    .update(agents)
    .set(updateData)
    .where(eq(agents.id, id))
    .returning();

  return c.json(updated);
});

// POST /api/v1/agents/:id/heartbeat — Refresh AAT
app.post('/:id/heartbeat', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agentPayload = c.get('agent');

  if (agentPayload.agent_id !== id) {
    return c.json({ error: 'Can only heartbeat your own agent' }, 403);
  }

  await db.update(agents).set({
    lastHeartbeat: new Date(),
    updatedAt: new Date(),
  }).where(eq(agents.id, id));

  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

  const token = await issueAAT({
    id: agent.id,
    did: agent.did,
    trustLevel: agent.trustLevel,
  });

  return c.json({ token, lastHeartbeat: new Date().toISOString() });
});

// DELETE /api/v1/agents/:id — Deregister agent (soft delete)
app.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agentPayload = c.get('agent');

  if (agentPayload.agent_id !== id) {
    return c.json({ error: 'Can only deregister your own agent' }, 403);
  }

  await db.update(agents).set({
    status: AGENT_STATUS.DEREGISTERED,
    updatedAt: new Date(),
  }).where(eq(agents.id, id));

  return c.json({ message: 'Agent deregistered' });
});

// GET /agents/:id/.well-known/agent.json — A2A Agent Card
app.get('/:id/.well-known/agent.json', async (c) => {
  const id = c.req.param('id');
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

  if (!agent || agent.status !== AGENT_STATUS.ACTIVE) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const skills = await db.select().from(agentSkills).where(eq(agentSkills.agentId, id));

  const agentCard = {
    name: agent.displayName,
    description: agent.description ?? '',
    url: `${process.env.PLATFORM_URL ?? 'https://swarmdock.ai'}/agents/${agent.id}`,
    version: '1.0.0',
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    capabilities: {
      streaming: false,
      extendedAgentCard: true,
    },
    skills: skills.map((s) => ({
      id: s.skillId,
      name: s.skillName,
      description: s.description,
      tags: s.tags,
      examples: s.examplePrompts,
      inputModes: ['text', 'application/json'],
      outputModes: ['text', 'application/json'],
    })),
    authentication: {
      schemes: ['bearer'],
      credentials: 'swarmdock-issued-token',
    },
    provider: {
      organization: agent.framework ?? 'unknown',
      url: agent.agentCardUrl ?? undefined,
    },
  };

  return c.json(agentCard);
});

// POST /api/v1/agents/match — Find best-matching agents for a task
app.post('/match', async (c) => {
  const body = await c.req.json();
  const { description, skills, limit = 10 } = body as { description: string; skills?: string[]; limit?: number };

  if (!description) return c.json({ error: 'Description required' }, 400);

  const queryEmbedding = await embed(description, 'query');
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  // Use raw SQL for pgvector cosine distance
  const results = await db.execute(sql`
    SELECT a.*,
           1 - (a.description_embedding <=> ${vectorStr}::vector) as similarity
    FROM agents a
    WHERE a.description_embedding IS NOT NULL
      AND a.status = 'active'
    ORDER BY a.description_embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  return c.json({ matches: results.rows });
});

export default app;
