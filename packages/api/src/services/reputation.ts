import { db } from '../db/client.js';
import { agentReputation, agentRatings, agents, tasks } from '../db/schema.js';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { REPUTATION_DIMENSIONS } from '@swarmdock/shared';
import type { ReputationDimension, AgentReputationRecord } from '@swarmdock/shared';

const DIMENSION_SCORE_FIELD: Record<ReputationDimension, keyof typeof agentRatings> = {
  quality: 'qualityScore',
  speed: 'speedScore',
  communication: 'communicationScore',
  reliability: 'reliabilityScore',
  value: 'valueScore',
};

/**
 * Compute the weight for a rating based on rater reputation, account age, and task value.
 *
 * weight = raterRepScore * 2 * min(1, raterAgeDays/30) * log10(max(taskValue, 100)) / 2
 *
 * If mutual ratings between rater and ratee exceed 3 with avg > 0.9, apply collusion penalty (x0.1).
 */
export async function computeRatingWeight(
  raterId: string,
  rateeId: string,
  taskValue: bigint,
): Promise<number> {
  // Get rater's overall reputation score (quality dimension as proxy)
  const [raterRep] = await db
    .select({ score: agentReputation.score })
    .from(agentReputation)
    .where(and(eq(agentReputation.agentId, raterId), eq(agentReputation.dimension, 'quality')))
    .limit(1);

  const raterRepScore = raterRep?.score ?? 0.5;

  // Get rater's account age and wallet for Sybil detection
  const [raterAgent] = await db
    .select({ createdAt: agents.createdAt, walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, raterId))
    .limit(1);

  const raterAgeDays = raterAgent
    ? (Date.now() - raterAgent.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  const taskValueNum = Number(taskValue);
  let weight =
    raterRepScore * 2 *
    Math.min(1, raterAgeDays / 30) *
    Math.log10(Math.max(taskValueNum, 100)) / 2;

  // Sybil detection: same wallet address = near-zero weight
  const [rateeAgent] = await db
    .select({ walletAddress: agents.walletAddress })
    .from(agents)
    .where(eq(agents.id, rateeId))
    .limit(1);

  if (raterAgent?.walletAddress && raterAgent.walletAddress === rateeAgent?.walletAddress) {
    weight *= 0.01; // Near-zero weight for same-wallet ratings (likely Sybil)
  }

  // Collusion detection: check mutual ratings between rater and ratee
  const mutualRatings = await db
    .select({
      cnt: count(),
      avgScore: sql<number>`avg(${agentRatings.overallScore})`,
    })
    .from(agentRatings)
    .where(and(eq(agentRatings.raterId, rateeId), eq(agentRatings.rateeId, raterId)));

  const mutualCount = Number(mutualRatings[0]?.cnt ?? 0);
  const mutualAvg = mutualRatings[0]?.avgScore ?? 0;

  // Tighter thresholds: >= 3 mutual ratings (not > 3) with avg > 0.85 (not 0.9)
  if (mutualCount >= 3 && mutualAvg > 0.85) {
    weight *= 0.1; // Collusion penalty
  }

  return Math.max(weight, 0.01); // Floor at 0.01 to avoid zero-weight ratings
}

/**
 * Update reputation dimensions for an agent after a rating is submitted.
 */
export async function updateReputationFromRating(
  rateeId: string,
  rating: {
    raterId: string;
    taskId: string;
    qualityScore: number;
    speedScore?: number | null;
    communicationScore?: number | null;
    reliabilityScore?: number | null;
    valueScore?: number | null;
  },
): Promise<void> {
  // Get the task value for weight calculation
  const [task] = await db
    .select({ budgetMax: tasks.budgetMax, finalPrice: tasks.finalPrice })
    .from(tasks)
    .where(eq(tasks.id, rating.taskId))
    .limit(1);

  const taskValue = task?.finalPrice ?? task?.budgetMax ?? 0n;
  const weight = await computeRatingWeight(rating.raterId, rateeId, taskValue);

  const dimensionScores: Partial<Record<ReputationDimension, number | null>> = {
    quality: rating.qualityScore,
    speed: rating.speedScore ?? null,
    communication: rating.communicationScore ?? null,
    reliability: rating.reliabilityScore ?? null,
    value: rating.valueScore ?? null,
  };

  for (const dimension of REPUTATION_DIMENSIONS) {
    const scoreValue = dimensionScores[dimension];
    if (scoreValue == null) continue;

    // Fetch existing reputation row
    const [existing] = await db
      .select()
      .from(agentReputation)
      .where(and(eq(agentReputation.agentId, rateeId), eq(agentReputation.dimension, dimension)))
      .limit(1);

    const totalRatings = (existing?.totalRatings ?? 0) + 1;

    // Weighted moving average: newScore = (oldScore * oldWeight + newScore * newWeight) / (oldWeight + newWeight)
    const oldWeight = existing ? existing.totalRatings : 0;
    const newScore = (((existing?.score ?? 0.5) * oldWeight) + (scoreValue * weight)) / (oldWeight + weight);

    // Confidence increases with number of ratings, asymptotically approaching 1
    const confidence = 1 - 1 / (1 + totalRatings * 0.2);

    // Calculate recent trend: compare current score to 30-day-ago score
    const recentTrend = await calculateRecentTrend(rateeId, dimension);

    // Upsert reputation row
    await db
      .insert(agentReputation)
      .values({
        agentId: rateeId,
        dimension,
        score: Math.max(0, Math.min(1, newScore)),
        confidence,
        totalRatings,
        recentTrend,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [agentReputation.agentId, agentReputation.dimension],
        set: {
          score: Math.max(0, Math.min(1, newScore)),
          confidence,
          totalRatings,
          recentTrend,
          updatedAt: new Date(),
        },
      });
  }
}

/**
 * Calculate the recent trend for a dimension over the last 30 days.
 * Returns the delta between current weighted avg and 30-day-ago weighted avg.
 */
async function calculateRecentTrend(
  agentId: string,
  dimension: ReputationDimension,
): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const scoreField = DIMENSION_SCORE_FIELD[dimension];

  // Get all ratings for this agent in this dimension
  const allRatings = await db
    .select({
      score: agentRatings[scoreField] as typeof agentRatings.qualityScore,
      createdAt: agentRatings.createdAt,
    })
    .from(agentRatings)
    .where(eq(agentRatings.rateeId, agentId))
    .orderBy(desc(agentRatings.createdAt));

  if (allRatings.length < 2) return 0;

  const recentScores = allRatings
    .filter((r) => r.createdAt >= thirtyDaysAgo && r.score != null)
    .map((r) => r.score!);

  const olderScores = allRatings
    .filter((r) => r.createdAt < thirtyDaysAgo && r.score != null)
    .map((r) => r.score!);

  if (recentScores.length === 0 || olderScores.length === 0) return 0;

  const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
  const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;

  return recentAvg - olderAvg;
}

/**
 * Get all reputation dimensions for an agent.
 */
export async function getReputation(agentId: string): Promise<AgentReputationRecord[]> {
  const rows = await db
    .select()
    .from(agentReputation)
    .where(eq(agentReputation.agentId, agentId));

  return rows.map((row) => ({
    agentId: row.agentId,
    dimension: row.dimension as ReputationDimension,
    score: row.score,
    confidence: row.confidence,
    totalRatings: row.totalRatings,
    recentTrend: row.recentTrend,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Calculate trust level based on completed tasks and reputation scores.
 *
 * L0: default (no completed tasks)
 * L1: 1+ completed task
 * L2: 5+ completed tasks with avg quality > 0.5
 * L3: 20+ completed tasks with avg quality > 0.7
 * L4: 50+ completed tasks with avg quality > 0.8 and confidence > 0.7
 */
export async function calculateTrustLevel(agentId: string): Promise<number> {
  // Count completed tasks (as assignee)
  const [completedResult] = await db
    .select({ cnt: count() })
    .from(tasks)
    .where(and(eq(tasks.assigneeId, agentId), eq(tasks.status, 'completed')));

  const completedCount = Number(completedResult?.cnt ?? 0);

  if (completedCount === 0) return 0;

  // Get quality reputation
  const [qualityRep] = await db
    .select({ score: agentReputation.score, confidence: agentReputation.confidence })
    .from(agentReputation)
    .where(and(eq(agentReputation.agentId, agentId), eq(agentReputation.dimension, 'quality')))
    .limit(1);

  const qualityScore = qualityRep?.score ?? 0;
  const confidence = qualityRep?.confidence ?? 0;

  if (completedCount >= 50 && qualityScore > 0.8 && confidence > 0.7) return 4;
  if (completedCount >= 20 && qualityScore > 0.7) return 3;
  if (completedCount >= 5 && qualityScore > 0.5) return 2;
  return 1;
}

/**
 * Calculate and persist the agent's trust level.
 */
export async function updateTrustLevel(agentId: string): Promise<number> {
  const level = await calculateTrustLevel(agentId);

  await db
    .update(agents)
    .set({ trustLevel: level, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  return level;
}
