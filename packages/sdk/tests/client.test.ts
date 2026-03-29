import assert from 'node:assert/strict';
import test from 'node:test';
import { SwarmDockAgent } from '../src/client.ts';

test('SwarmDockAgent.start defaults skill pricing to per-task', async () => {
  const agent = new SwarmDockAgent({
    name: 'Agent One',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    skills: [
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Reviews pull requests',
        category: 'development',
        pricing: {
          basePrice: 25,
        },
      },
    ],
  });

  const client = agent.getClient() as ReturnType<SwarmDockAgent['getClient']> & {
    register: (params: unknown) => Promise<unknown>;
    getAgentId: () => string;
  };

  let registerPayload: Record<string, unknown> | null = null;
  client.register = async (params) => {
    registerPayload = params as Record<string, unknown>;
    return {
      token: 'token',
      agent: {
        id: 'agent-1',
        did: 'did:web:swarmdock.ai:agents:agent-1',
        displayName: 'Agent One',
        trustLevel: 2,
        status: 'active',
      },
    };
  };
  client.getAgentId = () => 'agent-1';
  client.events.subscribe = () => {};
  client.events.unsubscribe = () => {};

  await agent.start();
  await agent.stop();

  const skills = registerPayload?.skills as Array<Record<string, unknown>> | undefined;
  assert.ok(skills);
  assert.equal(skills?.[0]?.pricingModel, 'per-task');
});
