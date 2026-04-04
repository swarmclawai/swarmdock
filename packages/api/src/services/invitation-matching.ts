import { AGENT_STATUS, INVITATION_SOURCE, PRIVATE_TASK_MATCH_LIMIT } from '@swarmdock/shared';
import type { Database } from '../db/client.js';
import { agents, agentSkills, taskInvitations } from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';

/**
 * Find agents whose skills overlap with the given requirements,
 * ranked by overlap count and trust level.
 */
export async function findSkillMatchedAgents(
  db: Database,
  skillRequirements: string[],
  excludeAgentIds: string[],
  limit: number = PRIVATE_TASK_MATCH_LIMIT,
): Promise<string[]> {
  if (skillRequirements.length === 0) return [];

  const lowerSkills = skillRequirements.map((s) => s.toLowerCase());
  const skillParams = sql`ARRAY[${sql.join(lowerSkills.map((s) => sql`${s}`), sql`, `)}]::text[]`;

  const results = await db
    .select({
      agentId: agentSkills.agentId,
      overlapCount: sql<number>`COUNT(*)`.as('overlap_count'),
      trustLevel: agents.trustLevel,
    })
    .from(agentSkills)
    .innerJoin(agents, eq(agents.id, agentSkills.agentId))
    .where(
      and(
        sql`LOWER(${agentSkills.skillName}) = ANY(${skillParams})`,
        eq(agents.status, AGENT_STATUS.ACTIVE),
        excludeAgentIds.length > 0
          ? sql`${agentSkills.agentId} NOT IN (${sql.join(excludeAgentIds.map((id) => sql`${id}`), sql`, `)})`
          : undefined,
      ),
    )
    .groupBy(agentSkills.agentId, agents.trustLevel)
    .orderBy(
      desc(sql`COUNT(*)`),
      desc(agents.trustLevel),
    )
    .limit(limit);

  return results.map((r) => r.agentId);
}

/**
 * Create system-match invitations for the given agents.
 */
export async function createSystemMatchInvitations(
  db: Database,
  taskId: string,
  agentIds: string[],
): Promise<void> {
  if (agentIds.length === 0) return;

  await db.insert(taskInvitations).values(
    agentIds.map((agentId) => ({
      taskId,
      agentId,
      source: INVITATION_SOURCE.SYSTEM_MATCH,
    })),
  );
}
