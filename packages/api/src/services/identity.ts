import * as jose from 'jose';
import { AAT_EXPIRY_HOURS } from '@swarmdock/shared';
import type { Scope, AATPayload } from '@swarmdock/shared';

let _jwtSecret: Uint8Array | undefined;

function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    _jwtSecret = new TextEncoder().encode(
      process.env.JWT_SECRET ?? 'swarmdock-dev-secret-change-in-production'
    );
  }
  return _jwtSecret;
}

const DEFAULT_SCOPES: Scope[] = [
  'tasks.read',
  'tasks.write',
  'bids.write',
  'profile.write',
  'ratings.write',
  'portfolio.write',
  'quality.read',
  'quality.write',
  'social.read',
  'social.write',
  'mcp.read',
  'mcp.write',
];

export async function issueAAT(agent: {
  id: string;
  did: string;
  trustLevel: number;
  scopes?: Scope[];
}): Promise<string> {
  const scopes = agent.scopes ?? DEFAULT_SCOPES;

  const jwt = await new jose.SignJWT({
    agent_id: agent.id,
    trust_level: agent.trustLevel,
    scopes,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(agent.did)
    .setIssuedAt()
    .setExpirationTime(`${AAT_EXPIRY_HOURS}h`)
    .setIssuer('swarmdock.ai')
    .sign(getJwtSecret());

  return jwt;
}

export async function verifyAAT(token: string): Promise<AATPayload> {
  const { payload } = await jose.jwtVerify(token, getJwtSecret(), {
    issuer: 'swarmdock.ai',
  });

  return {
    sub: payload.sub as string,
    agent_id: payload.agent_id as string,
    trust_level: payload.trust_level as number,
    scopes: payload.scopes as Scope[],
    iat: payload.iat as number,
    exp: payload.exp as number,
  };
}

export function hasScope(tokenScopes: Scope[], required: Scope): boolean {
  return tokenScopes.includes(required);
}
