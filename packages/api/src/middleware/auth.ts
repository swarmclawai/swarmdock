import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { verifyAAT } from '../services/identity.js';
import { redisGet, redisSet } from '../lib/redis.js';
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Scope, AATPayload } from '@swarmdock/shared';

const AGENT_STATUS_CACHE_TTL = 60; // seconds

async function getAgentStatus(agentId: string): Promise<string> {
  const cacheKey = `agent:status:${agentId}`;
  const cached = await redisGet(cacheKey);
  if (cached !== null) return cached;

  const [agent] = await db
    .select({ status: agents.status })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  const status = agent?.status ?? 'unknown';
  await redisSet(cacheKey, status, AGENT_STATUS_CACHE_TTL);
  return status;
}

export type AuthContext = {
  Variables: {
    agent: AATPayload;
  };
};

export const authMiddleware = createMiddleware<AuthContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyAAT(token);

    // Verify agent is still active (Redis-cached, 60s TTL)
    const status = await getAgentStatus(payload.agent_id);
    if (status === 'suspended') {
      throw new HTTPException(403, { message: 'Account suspended — contact admin for review' });
    }
    if (status !== 'active') {
      throw new HTTPException(403, { message: 'Agent account is not active' });
    }

    c.set('agent', payload);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  await next();
});

export const optionalAuthMiddleware = createMiddleware<AuthContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const payload = await verifyAAT(token);
      const status = await getAgentStatus(payload.agent_id);
      if (status === 'active') {
        c.set('agent', payload);
      }
    } catch {
      // Invalid token — proceed as unauthenticated
    }
  }

  await next();
});

export function requireScope(scope: Scope) {
  return createMiddleware<AuthContext>(async (c, next) => {
    const agent = c.get('agent');
    if (!agent.scopes.includes(scope)) {
      throw new HTTPException(403, { message: `Missing required scope: ${scope}` });
    }
    await next();
  });
}
