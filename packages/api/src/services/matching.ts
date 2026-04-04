import { db } from '../db/client.js';
import { agents, agentReputation } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

/** Matching weight constants */
const WEIGHT_TRUST = 0.20;
const WEIGHT_QUALITY = 0.35;
const WEIGHT_HISTORY = 0.25;
const WEIGHT_COLLABORATIVE = 0.20;
const PREMIUM_BOOST = 1.5;

interface MatchScore {
  agentId: string;
  score: number;
  components: {
    trustLevel: number;
    qualityScore: number;
    historicalSuccess: number;
    collaborativeScore: number;
  };
}

/**
 * Score candidates for a task using multiple signals:
 * 1. Trust level (0-4, normalized to 0-1)
 * 2. Quality reputation score (0-1)
 * 3. Historical success rate with this requester (0-1)
 * 4. Collaborative filtering: agents hired by similar requesters (0-1)
 */
export async function scoreMatchCandidates(
  taskId: string,
  requesterId: string,
  candidateIds: string[],
): Promise<MatchScore[]> {
  if (candidateIds.length === 0) return [];

  // Batch fetch all signals
  const [candidateAgents, reputations, hiringHistory, collaborativeScores] = await Promise.all([
    // 1. Trust levels + premium status
    db.select({ id: agents.id, trustLevel: agents.trustLevel, premiumTier: agents.premiumTier })
      .from(agents)
      .where(sql`id = ANY(${candidateIds})`),

    // 2. Quality reputation
    db.select({ agentId: agentReputation.agentId, score: agentReputation.score })
      .from(agentReputation)
      .where(and(
        sql`agent_id = ANY(${candidateIds})`,
        eq(agentReputation.dimension, 'quality'),
      )),

    // 3. Historical success: how many tasks this requester completed with each candidate
    db.execute(sql`
      SELECT assignee_id,
             count(*) AS total_tasks,
             count(*) FILTER (WHERE status = 'completed') AS completed_tasks
      FROM tasks
      WHERE requester_id = ${requesterId}
        AND assignee_id = ANY(${candidateIds})
      GROUP BY assignee_id
    `),

    // 4. Collaborative filtering: agents hired by requesters who also hired these candidates
    db.execute(sql`
      WITH similar_requesters AS (
        SELECT DISTINCT requester_id
        FROM tasks
        WHERE assignee_id = ANY(${candidateIds})
          AND status = 'completed'
          AND requester_id != ${requesterId}
      ),
      peer_hires AS (
        SELECT assignee_id, count(*) AS hire_count
        FROM tasks
        WHERE requester_id IN (SELECT requester_id FROM similar_requesters)
          AND assignee_id = ANY(${candidateIds})
          AND status = 'completed'
        GROUP BY assignee_id
      )
      SELECT assignee_id, hire_count FROM peer_hires
    `),
  ]);

  // Build lookup maps
  const trustMap = new Map(candidateAgents.map((a) => [a.id, a.trustLevel]));
  const premiumMap = new Map(candidateAgents.map((a) => [a.id, a.premiumTier]));
  const qualityMap = new Map(reputations.map((r) => [r.agentId, r.score]));

  const historyMap = new Map<string, { total: number; completed: number }>();
  for (const row of hiringHistory.rows as Array<{ assignee_id: string; total_tasks: number; completed_tasks: number }>) {
    historyMap.set(row.assignee_id, { total: Number(row.total_tasks), completed: Number(row.completed_tasks) });
  }

  const collabMap = new Map<string, number>();
  let maxCollabCount = 1;
  for (const row of collaborativeScores.rows as Array<{ assignee_id: string; hire_count: number }>) {
    const count = Number(row.hire_count);
    collabMap.set(row.assignee_id, count);
    if (count > maxCollabCount) maxCollabCount = count;
  }

  // Score each candidate
  const scores: MatchScore[] = candidateIds.map((agentId) => {
    const trustLevel = (trustMap.get(agentId) ?? 0) / 4; // Normalize 0-4 → 0-1
    const qualityScore = qualityMap.get(agentId) ?? 0.5;  // Default to 0.5
    const history = historyMap.get(agentId);
    const historicalSuccess = history ? history.completed / history.total : 0;
    const collaborativeScore = (collabMap.get(agentId) ?? 0) / maxCollabCount;

    // Weighted blend
    let score =
      trustLevel * WEIGHT_TRUST +
      qualityScore * WEIGHT_QUALITY +
      historicalSuccess * WEIGHT_HISTORY +
      collaborativeScore * WEIGHT_COLLABORATIVE;

    // Premium agents get a boost
    if (premiumMap.get(agentId)) {
      score *= PREMIUM_BOOST;
    }

    return {
      agentId,
      score,
      components: { trustLevel, qualityScore, historicalSuccess, collaborativeScore },
    };
  });

  return scores.sort((a, b) => b.score - a.score);
}
