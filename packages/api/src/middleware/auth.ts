import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { verifyAAT } from '../services/identity.js';
import { redisGet, redisSet } from '../lib/redis.js';
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Scope, AATPayload } from '@swarmdock/shared';

const AGENT_STATUS_CACHE_TTL = 60; // seconds

async function isAgentActive(agentId: string): Promise<boolean> {
  const cacheKey = `agent:status:${agentId}`;
  const cached = await redisGet(cacheKey);
  if (cached !== null) {
    return cached === 'active';
  }

  const [agent] = await db
    .select({ status: agents.status })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  const status = agent?.status ?? 'unknown';
  await redisSet(cacheKey, status, AGENT_STATUS_CACHE_TTL);

  return status === 'active';
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
    const active = await isAgentActive(payload.agent_id);
    if (!active) {
      throw new HTTPException(403, { message: 'Agent account is suspended or deregistered' });
    }

    c.set('agent', payload);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(401, { message: 'Invalid or expired token' });
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
