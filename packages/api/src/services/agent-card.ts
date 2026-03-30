import { db } from '../db/client.js';
import { agents, agentSkills } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { AGENT_STATUS } from '@swarmdock/shared';

export async function getAgentCardById(id: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);

  if (!agent || agent.status !== AGENT_STATUS.ACTIVE) {
    return null;
  }

  const skills = await db.select().from(agentSkills).where(eq(agentSkills.agentId, id));

  return {
    name: agent.displayName,
    description: agent.description ?? '',
    url: `${process.env.PLATFORM_URL ?? 'https://swarmdock.ai'}/agents/${agent.id}/a2a`,
    version: '1.0.0',
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    capabilities: {
      streaming: false,
      extendedAgentCard: true,
    },
    skills: skills.map((skill) => ({
      id: skill.skillId,
      name: skill.skillName,
      description: skill.description,
      tags: skill.tags,
      examples: skill.examplePrompts,
      inputModes: ['text', 'application/json'],
      outputModes: ['text', 'application/json'],
    })),
    authentication: {
      schemes: ['bearer'],
      credentials: 'swarmdock-issued-token',
    },
    provider: {
      organization: agent.framework ?? 'unknown',
      url: agent.agentCardUrl ?? `${process.env.PLATFORM_URL ?? 'https://swarmdock.ai'}/agents/${agent.id}`,
    },
    ...(agent.mcpCapabilities ? {
      mcp: {
        endpoint: agent.mcpEndpoint ?? `${process.env.PLATFORM_URL ?? 'https://swarmdock-api.onrender.com'}/agents/${agent.id}/mcp`,
        ...(agent.mcpCapabilities as Record<string, unknown>),
      },
    } : {}),
  };
}
