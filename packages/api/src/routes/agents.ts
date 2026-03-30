import { Hono } from 'hono';
import { db } from '../db/client.js';
import { agents, agentSkills, challenges, portfolioItems, tasks } from '../db/schema.js';
import { eq, and, inArray, sql, ilike, or, count } from 'drizzle-orm';
import { generateChallenge, verifySignature, generateDID } from '../lib/crypto.js';
import { issueAAT } from '../services/identity.js';
import { embed, embedBatch } from '../services/embeddings.js';
import {
  AgentRegisterSchema,
  AgentVerifySchema,
  AgentLoginChallengeSchema,
  AgentUpdateSchema,
  AgentSkillsUpdateSchema,
  AgentListQuerySchema,
  PortfolioItemUpdateSchema,
  AgentKeyRotateSchema,
  AgentVerifyOwnerSchema,
  AGENT_STATUS,
  TASK_STATUS,
} from '@swarmdock/shared';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { rateLimitAuth, rateLimitStrict } from '../middleware/rateLimit.js';
import { eventBus } from '../lib/events.js';
import { getRatingsSummary } from '../services/ratings.js';
import { provisionAgentWallet } from '../services/wallet.js';
import { updateTrustLevel } from '../services/reputation.js';
import { getAgentPortfolio, createPortfolioItem, updatePortfolioItem, deletePortfolioItem } from '../services/portfolio.js';
import { fetchOrderedRowsByIds, searchAgentsIndex } from '../services/search.js';

const app = new Hono<AuthContext>();

function sanitizeAgent<T extends { publicKey?: string }>(agent: T) {
  const { publicKey: _publicKey, ...safeAgent } = agent;
  return safeAgent;
}

async function consumeValidChallenge(publicKey: string, challenge: string, signature: string) {
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
    throw new Error('Challenge not found or already used');
  }

  if (new Date() > storedChallenge.expiresAt) {
    throw new Error('Challenge expired');
  }

  if (!verifySignature(publicKey, challenge, signature)) {
    throw new Error('Invalid signature');
  }

  await db.update(challenges).set({ used: true }).where(eq(challenges.id, storedChallenge.id));
}

async function issueAgentSession(agent: { id: string; did: string; trustLevel: number; displayName: string; status: string }) {
  const token = await issueAAT({
    id: agent.id,
    did: agent.did,
    trustLevel: agent.trustLevel,
  });

  return {
    token,
    agent: {
      id: agent.id,
      did: agent.did,
      displayName: agent.displayName,
      trustLevel: agent.trustLevel,
      status: agent.status,
    },
  };
}

// POST /api/v1/agents/register — Start registration, return challenge
app.post('/register', rateLimitAuth, async (c) => {
  const body = await c.req.json();
  const parsed = AgentRegisterSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { publicKey, displayName, description, framework, frameworkVersion, modelProvider, modelName, walletAddress, agentCardUrl, skills } = parsed.data;
  const agentCard = (body as Record<string, unknown>).agentCard ?? null;

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
    const updateFields: Record<string, unknown> = {
      displayName, description, framework, frameworkVersion, modelProvider, modelName, agentCardUrl,
      agentCard, status: AGENT_STATUS.PENDING, updatedAt: new Date(),
    };
    if (walletAddress) updateFields.walletAddress = walletAddress;
    await db.update(agents).set(updateFields).where(eq(agents.id, agentId));
  } else {
    const tempDid = `did:web:swarmdock.ai:agents:pending`;
    const [agent] = await db.insert(agents).values({
      did: tempDid,
      publicKey, displayName, description, framework, frameworkVersion, modelProvider, modelName,
      walletAddress: walletAddress ?? '0x0000000000000000000000000000000000000000',
      agentCardUrl, agentCard,
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

  // Auto-provision wallet via AgentKit if agent didn't provide one
  if (!walletAddress) {
    provisionAgentWallet(agentId).then(async (wallet) => {
      if (wallet) {
        await db.update(agents).set({ walletAddress: wallet.address, updatedAt: new Date() }).where(eq(agents.id, agentId));
      }
    }).catch(console.error);
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

// POST /api/v1/agents/login/challenge — Request a fresh auth challenge
app.post('/login/challenge', rateLimitAuth, async (c) => {
  const body = await c.req.json();
  const parsed = AgentLoginChallengeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.publicKey, parsed.data.publicKey), eq(agents.status, AGENT_STATUS.ACTIVE)))
    .limit(1);

  if (!agent) {
    return c.json({ error: 'Active agent not found for this public key' }, 404);
  }

  const { challenge, expiresAt } = generateChallenge();
  await db.insert(challenges).values({
    publicKey: parsed.data.publicKey,
    challenge,
    expiresAt,
  });

  return c.json({
    challenge,
    expiresAt: expiresAt.toISOString(),
  });
});

// POST /api/v1/agents/verify — Complete challenge-response, issue AAT
app.post('/verify', rateLimitAuth, async (c) => {
  const body = await c.req.json();
  const parsed = AgentVerifySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { publicKey, challenge, signature } = parsed.data;

  try {
    await consumeValidChallenge(publicKey, challenge, signature);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Challenge verification failed';
    return c.json({ error: message }, message === 'Invalid signature' ? 401 : 400);
  }

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
    verifiedAt: new Date(),
    lastHeartbeat: new Date(),
    lastActiveAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(agents.id, agent.id));

  const session = await issueAgentSession({
    id: agent.id,
    did: agent.did,
    trustLevel: 2,
    displayName: agent.displayName,
    status: AGENT_STATUS.ACTIVE,
  });

  eventBus.broadcast({
    type: 'agent.registered',
    data: { agentId: agent.id, did: agent.did, displayName: agent.displayName },
  });

  return c.json(session);
});

// POST /api/v1/agents/login/verify — Verify challenge and issue a fresh token
app.post('/login/verify', rateLimitAuth, async (c) => {
  const body = await c.req.json();
  const parsed = AgentVerifySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  try {
    await consumeValidChallenge(parsed.data.publicKey, parsed.data.challenge, parsed.data.signature);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Challenge verification failed';
    return c.json({ error: message }, message === 'Invalid signature' ? 401 : 400);
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.publicKey, parsed.data.publicKey), eq(agents.status, AGENT_STATUS.ACTIVE)))
    .limit(1);

  if (!agent) {
    return c.json({ error: 'Active agent not found for this public key' }, 404);
  }

  await db.update(agents).set({
    lastHeartbeat: new Date(),
    updatedAt: new Date(),
  }).where(eq(agents.id, agent.id));

  return c.json(await issueAgentSession(agent));
});

// GET /api/v1/agents/:id/ratings — Canonical public ratings route
app.get('/:id/ratings', async (c) => {
  return c.json(await getRatingsSummary(c.req.param('id')));
});

// GET /api/v1/agents/:id/portfolio — Completed work samples derived from tasks
app.get('/:id/portfolio', async (c) => {
  return c.json(await getAgentPortfolio(c.req.param('id')));
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
    ...sanitizeAgent(agent),
    skillCount: skills.length,
    topSkills: skills.slice(0, 4).map((skill) => ({
      skillId: skill.skillId,
      skillName: skill.skillName,
      category: skill.category,
    })),
    skills,
  });
});

// GET /api/v1/agents — List agents (with optional skill filter)
app.get('/', async (c) => {
  const query = AgentListQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query', details: query.error.flatten() }, 400);
  }

  const { q, skills, limit, offset } = query.data;
  const indexed = await searchAgentsIndex({ q, skills, limit, offset });
  if (indexed) {
    if (indexed.ids.length === 0) {
      return c.json({ agents: [], limit, offset, total: indexed.total, facets: indexed.facets });
    }

    const result = await fetchOrderedRowsByIds(indexed.ids, () =>
      db
        .select()
        .from(agents)
        .where(inArray(agents.id, indexed.ids)),
    );

    const skillRows = await db
      .select({
        agentId: agentSkills.agentId,
        skillId: agentSkills.skillId,
        skillName: agentSkills.skillName,
        category: agentSkills.category,
      })
      .from(agentSkills)
      .where(inArray(agentSkills.agentId, indexed.ids));

    const skillsByAgent = new Map<string, Array<{ skillId: string; skillName: string; category: string }>>();
    for (const skill of skillRows) {
      const existing = skillsByAgent.get(skill.agentId) ?? [];
      existing.push({
        skillId: skill.skillId,
        skillName: skill.skillName,
        category: skill.category,
      });
      skillsByAgent.set(skill.agentId, existing);
    }

    return c.json({
      agents: result.map((agent) => {
        const agentSkillRows = skillsByAgent.get(agent.id) ?? [];
        return {
          ...sanitizeAgent(agent),
          skillCount: agentSkillRows.length,
          topSkills: agentSkillRows.slice(0, 4),
        };
      }),
      limit,
      offset,
      total: indexed.total,
      facets: indexed.facets,
    });
  }

  const conditions = [eq(agents.status, AGENT_STATUS.ACTIVE)];

  if (q?.trim()) {
    const pattern = `%${q.trim()}%`;
    conditions.push(or(
      ilike(agents.displayName, pattern),
      ilike(agents.description, pattern),
      ilike(agents.framework, pattern),
      ilike(agents.modelProvider, pattern),
      ilike(agents.modelName, pattern),
    )!);
  }

  if (skills) {
    const skillList = skills
      .split(',')
      .map((skill) => skill.trim().toLowerCase())
      .filter(Boolean);

    if (skillList.length > 0) {
      const parameterizedSkills = sql`ARRAY[${sql.join(skillList.map(s => sql`${s}`), sql`, `)}]::text[]`;
      const matchingAgentIds = await db
        .selectDistinct({ agentId: agentSkills.agentId })
        .from(agentSkills)
        .where(sql`
          LOWER(${agentSkills.skillId}) = ANY(${parameterizedSkills})
          OR LOWER(${agentSkills.skillName}) = ANY(${parameterizedSkills})
          OR LOWER(${agentSkills.category}) = ANY(${parameterizedSkills})
          OR EXISTS (
            SELECT 1
            FROM unnest(${agentSkills.tags}) AS tag
            WHERE LOWER(tag) = ANY(${parameterizedSkills})
          )
        `);

      if (matchingAgentIds.length === 0) {
        return c.json({ agents: [], limit, offset, total: 0 });
      }

      conditions.push(inArray(agents.id, matchingAgentIds.map((row) => row.agentId)));
    }
  }

  const whereClause = and(...conditions);
  const [{ total }] = await db.select({ total: count() }).from(agents).where(whereClause);
  const result = await db
    .select()
    .from(agents)
    .where(whereClause)
    .limit(limit)
    .offset(offset);

  const agentIds = result.map((agent) => agent.id);
  const skillRows = agentIds.length > 0
    ? await db
      .select({
        agentId: agentSkills.agentId,
        skillId: agentSkills.skillId,
        skillName: agentSkills.skillName,
        category: agentSkills.category,
      })
      .from(agentSkills)
      .where(inArray(agentSkills.agentId, agentIds))
    : [];

  const skillsByAgent = new Map<string, Array<{ skillId: string; skillName: string; category: string }>>();
  for (const skill of skillRows) {
    const existing = skillsByAgent.get(skill.agentId) ?? [];
    existing.push({
      skillId: skill.skillId,
      skillName: skill.skillName,
      category: skill.category,
    });
    skillsByAgent.set(skill.agentId, existing);
  }

  return c.json({
    agents: result.map((agent) => {
      const agentSkillRows = skillsByAgent.get(agent.id) ?? [];
      return {
        ...sanitizeAgent(agent),
        skillCount: agentSkillRows.length,
        topSkills: agentSkillRows.slice(0, 4),
      };
    }),
    limit,
    offset,
    total: Number(total),
  });
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

  eventBus.broadcast({
    type: 'agent.updated',
    data: { agentId: id },
  });

  const { webhookSecret: _ws, publicKey: _pk, ...safeUpdated } = updated;
  return c.json(safeUpdated);
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
    lastActiveAt: new Date(),
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

  eventBus.broadcast({
    type: 'agent.updated',
    data: { agentId: id },
  });

  return c.json({ message: 'Agent deregistered' });
});

// POST /api/v1/agents/:id/portfolio — Create portfolio item from completed task
app.post('/:id/portfolio', authMiddleware, requireScope('portfolio.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  if (agent.agent_id !== id) {
    return c.json({ error: 'Can only manage your own portfolio' }, 403);
  }

  const body = await c.req.json();
  const { taskId } = body as { taskId: string };

  if (!taskId) {
    return c.json({ error: 'taskId is required' }, 400);
  }

  try {
    const item = await createPortfolioItem(id, taskId);
    return c.json(item, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to create portfolio item' }, 400);
  }
});

// PATCH /api/v1/agents/:id/portfolio/:itemId — Update portfolio item pin/order
app.patch('/:id/portfolio/:itemId', authMiddleware, requireScope('portfolio.write'), async (c) => {
  const id = c.req.param('id');
  const itemId = c.req.param('itemId');
  const agent = c.get('agent');

  if (agent.agent_id !== id) {
    return c.json({ error: 'Can only manage your own portfolio' }, 403);
  }

  const body = await c.req.json();
  const parsed = PortfolioItemUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  try {
    const item = await updatePortfolioItem(itemId, id, parsed.data);
    return c.json(item);
  } catch {
    return c.json({ error: 'Portfolio item not found' }, 404);
  }
});

// DELETE /api/v1/agents/:id/portfolio/:itemId — Delete portfolio item
app.delete('/:id/portfolio/:itemId', authMiddleware, requireScope('portfolio.write'), async (c) => {
  const id = c.req.param('id');
  const itemId = c.req.param('itemId');
  const agent = c.get('agent');

  if (agent.agent_id !== id) {
    return c.json({ error: 'Can only manage your own portfolio' }, 403);
  }

  try {
    await deletePortfolioItem(itemId, id);
    return c.json({ message: 'Portfolio item deleted' });
  } catch {
    return c.json({ error: 'Portfolio item not found' }, 404);
  }
});

// PUT /api/v1/agents/:id/skills — Replace agent skills
app.put('/:id/skills', authMiddleware, requireScope('profile.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  if (agent.agent_id !== id) {
    return c.json({ error: 'Can only update your own skills' }, 403);
  }

  const body = await c.req.json();
  const parsed = AgentSkillsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const skills = parsed.data;

  const inserted = await db.transaction(async (tx) => {
    // Delete existing skills
    await tx.delete(agentSkills).where(eq(agentSkills.agentId, id));

    // Insert new skills
    const rows = await tx.insert(agentSkills).values(
      skills.map((s) => ({
        agentId: id,
        skillId: s.skillId,
        skillName: s.skillName,
        description: s.description,
        category: s.category,
        tags: s.tags,
        inputModes: s.inputModes,
        outputModes: s.outputModes,
        pricingModel: s.pricingModel,
        basePrice: BigInt(s.basePrice),
        examplePrompts: s.examplePrompts,
      })),
    ).returning();

    return rows;
  });

  eventBus.broadcast({ type: 'agent.updated', data: { agentId: id } });
  return c.json({ skills: inserted, count: inserted.length });
});

// Agent card served from index.ts at /agents/:id/.well-known/agent.json

// POST /api/v1/agents/match — Find best-matching agents for a task
app.post('/match', rateLimitStrict, async (c) => {
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

// POST /api/v1/agents/:id/rotate-key — Rotate Ed25519 public key
app.post('/:id/rotate-key', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  if (agent.agent_id !== id) {
    return c.json({ error: 'Can only rotate your own key' }, 403);
  }

  const body = await c.req.json();
  const parsed = AgentKeyRotateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { currentSignature, newPublicKey, newKeySignature, rotationChallenge } = parsed.data;

  // Fetch current public key
  const [currentAgent] = await db
    .select({ publicKey: agents.publicKey })
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);

  if (!currentAgent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Verify that the current key signed the rotation challenge
  if (!verifySignature(currentAgent.publicKey, rotationChallenge, currentSignature)) {
    return c.json({ error: 'Current key signature invalid' }, 401);
  }

  // Verify that the new key also signed the same challenge (proves possession)
  if (!verifySignature(newPublicKey, rotationChallenge, newKeySignature)) {
    return c.json({ error: 'New key signature invalid' }, 401);
  }

  // Check uniqueness of new key
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.publicKey, newPublicKey))
    .limit(1);

  if (existing) {
    return c.json({ error: 'New public key already in use' }, 409);
  }

  // Update key atomically
  await db.update(agents).set({
    publicKey: newPublicKey,
    updatedAt: new Date(),
  }).where(eq(agents.id, id));

  // Invalidate all existing unused challenges for the old key
  await db.update(challenges).set({ used: true }).where(
    and(eq(challenges.publicKey, currentAgent.publicKey), eq(challenges.used, false)),
  );

  // Issue new token
  const [updatedAgent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  const session = await issueAgentSession(updatedAgent);

  return c.json({ ...session, message: 'Key rotated successfully' });
});

// POST /api/v1/agents/:id/verify-owner — Verify human owner via signed message
app.post('/:id/verify-owner', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  if (agent.agent_id !== id) {
    return c.json({ error: 'Can only verify your own agent' }, 403);
  }

  const body = await c.req.json();
  const parsed = AgentVerifyOwnerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { ownerDid, signature, challenge } = parsed.data;

  // Fetch current public key
  const [currentAgent] = await db
    .select({ publicKey: agents.publicKey })
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);

  if (!currentAgent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  // Verify the signature proves the agent controls the key that claims the DID
  const message = `verify-owner:${ownerDid}:${challenge}`;
  if (!verifySignature(currentAgent.publicKey, message, signature)) {
    return c.json({ error: 'Invalid ownership proof' }, 401);
  }

  // Update ownerDid
  await db.update(agents).set({
    ownerDid,
    updatedAt: new Date(),
  }).where(eq(agents.id, id));

  // Recalculate trust level with owner verification boost
  const newTrustLevel = await updateTrustLevel(id);

  return c.json({ verified: true, ownerDid, trustLevel: newTrustLevel });
});

export default app;
