import {
  AGENT_STATUS,
  INVITATION_SOURCE,
  PRIVATE_TASK_MATCH_LIMIT,
  MATCHING_EMBEDDING_WEIGHT_DEFAULT,
  EMBEDDING_CANDIDATE_LIMIT,
} from '@swarmdock/shared';
import type { Database } from '../db/client.js';
import { agents, agentSkills, taskInvitations } from '../db/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';

function resolveEmbeddingWeight(): number {
  const raw = process.env.MATCHING_EMBEDDING_WEIGHT;
  if (!raw) return MATCHING_EMBEDDING_WEIGHT_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return MATCHING_EMBEDDING_WEIGHT_DEFAULT;
  }
  return parsed;
}

type SkillMatchRow = { agentId: string; overlapCount: number; trustLevel: number };

async function fetchSkillMatches(
  db: Database,
  skillRequirements: string[],
  excludeAgentIds: string[],
  limit: number,
): Promise<SkillMatchRow[]> {
  const lowerSkills = skillRequirements.map((s) => s.toLowerCase());
  const skillParams = sql`ARRAY[${sql.join(
    lowerSkills.map((s) => sql`${s}`),
    sql`, `,
  )}]::text[]`;

  const rows = await db
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
          ? sql`${agentSkills.agentId} NOT IN (${sql.join(
              excludeAgentIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : undefined,
      ),
    )
    .groupBy(agentSkills.agentId, agents.trustLevel)
    .orderBy(desc(sql`COUNT(*)`), desc(agents.trustLevel))
    .limit(limit);

  return rows.map((r) => ({
    agentId: r.agentId,
    overlapCount: Number(r.overlapCount),
    trustLevel: r.trustLevel,
  }));
}

type SemanticMatchRow = { agentId: string; similarity: number; trustLevel: number };

async function fetchSemanticMatches(
  db: Database,
  taskEmbedding: number[],
  excludeAgentIds: string[],
  limit: number,
): Promise<SemanticMatchRow[]> {
  const embedLiteral = `[${taskEmbedding.join(',')}]`;

  const rows = await db
    .select({
      agentId: agents.id,
      similarity: sql<number>`1 - (${agents.descriptionEmbedding} <=> ${embedLiteral}::vector)`.as('similarity'),
      trustLevel: agents.trustLevel,
    })
    .from(agents)
    .where(
      and(
        eq(agents.status, AGENT_STATUS.ACTIVE),
        sql`${agents.descriptionEmbedding} IS NOT NULL`,
        excludeAgentIds.length > 0
          ? sql`${agents.id} NOT IN (${sql.join(
              excludeAgentIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : undefined,
      ),
    )
    .orderBy(sql`${agents.descriptionEmbedding} <=> ${embedLiteral}::vector`)
    .limit(limit);

  return rows.map((r) => ({
    agentId: r.agentId,
    similarity: Number(r.similarity),
    trustLevel: r.trustLevel,
  }));
}

/**
 * Find agents to invite to a private task. Blends two candidate pools:
 *   - skill-name overlap (keyword gate, always used)
 *   - description-embedding cosine similarity (semantic boost, used when a
 *     task embedding is supplied and MATCHING_EMBEDDING_WEIGHT > 0)
 *
 * Both pools are unioned, each candidate scored as
 *   (1 - w) * normalizedOverlap + w * embeddingSimilarity
 * where `w` is MATCHING_EMBEDDING_WEIGHT (env or 0.3 default). Trust level is
 * the tiebreaker. Falls back to skill-only when no task embedding is available.
 */
export async function findSkillMatchedAgents(
  db: Database,
  skillRequirements: string[],
  excludeAgentIds: string[],
  limit: number = PRIVATE_TASK_MATCH_LIMIT,
  taskEmbedding: number[] | null = null,
): Promise<string[]> {
  if (skillRequirements.length === 0) return [];

  const weight = resolveEmbeddingWeight();
  const skillRows = await fetchSkillMatches(
    db,
    skillRequirements,
    excludeAgentIds,
    // Pull more candidates than needed when we'll re-rank with embeddings.
    taskEmbedding && weight > 0 ? EMBEDDING_CANDIDATE_LIMIT : limit,
  );

  // Fallback path: no embedding available, or weight zeroed out by operator.
  if (!taskEmbedding || weight === 0) {
    return skillRows.slice(0, limit).map((r) => r.agentId);
  }

  const semanticRows = await fetchSemanticMatches(
    db,
    taskEmbedding,
    excludeAgentIds,
    EMBEDDING_CANDIDATE_LIMIT,
  );

  const maxOverlap = Math.max(1, ...skillRows.map((r) => r.overlapCount));
  const merged = new Map<string, { overlap: number; similarity: number; trustLevel: number }>();

  for (const row of skillRows) {
    merged.set(row.agentId, {
      overlap: row.overlapCount / maxOverlap,
      similarity: 0,
      trustLevel: row.trustLevel,
    });
  }
  for (const row of semanticRows) {
    const existing = merged.get(row.agentId);
    if (existing) {
      existing.similarity = row.similarity;
    } else {
      merged.set(row.agentId, {
        overlap: 0,
        similarity: row.similarity,
        trustLevel: row.trustLevel,
      });
    }
  }

  const ranked = Array.from(merged.entries())
    .map(([agentId, { overlap, similarity, trustLevel }]) => ({
      agentId,
      score: (1 - weight) * overlap + weight * similarity,
      trustLevel,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.trustLevel - a.trustLevel;
    });

  return ranked.slice(0, limit).map((r) => r.agentId);
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
