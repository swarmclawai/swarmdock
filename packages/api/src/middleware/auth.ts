import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { verifyAAT } from '../services/identity.js';
import type { Scope, AATPayload } from '@swarmdock/shared';

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
    c.set('agent', payload);
  } catch {
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
