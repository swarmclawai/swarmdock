import { db } from '../db/client.js';
import { disputes, agentReputation, agents } from '../db/schema.js';
import { eq, and, ne, sql } from 'drizzle-orm';
import { DISPUTE_STATUS, DISPUTE_VERDICT } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';

type TribunalVoteRecord = Record<
  string,
  { verdict: string; notes: string | null; timestamp: string }
>;

/**
 * Select 3 random high-reputation agents to serve as tribunal judges.
 *
 * Requirements:
 * - Not involved in the dispute (not raisedBy or against)
 * - trust_level >= 2
 * - quality reputation score > 0.6
 */
export async function selectTribunalJudges(disputeId: string): Promise<string[]> {
  // Get the dispute to know which agents to exclude
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);

  if (!dispute) {
    throw new Error(`Dispute ${disputeId} not found`);
  }

  // Find eligible agents: trust_level >= 2, quality score > 0.6, not involved
  const excludedIds = [dispute.raisedByAgentId, dispute.againstAgentId].filter(
    (id): id is string => id != null,
  );

  const eligible = await db
    .select({ agentId: agents.id })
    .from(agents)
    .innerJoin(
      agentReputation,
      and(
        eq(agentReputation.agentId, agents.id),
        eq(agentReputation.dimension, 'quality'),
      ),
    )
    .where(
      and(
        sql`${agents.trustLevel} >= 2`,
        sql`${agentReputation.score} > 0.6`,
        sql`${agents.status} = 'active'`,
        ...excludedIds.map((id) => ne(agents.id, id)),
      ),
    );

  if (eligible.length < 3) {
    throw new Error(
      `Not enough eligible tribunal judges: found ${eligible.length}, need 3`,
    );
  }

  // Random selection of 3 judges
  const shuffled = eligible.sort(() => Math.random() - 0.5);
  const selectedIds = shuffled.slice(0, 3).map((row) => row.agentId);

  // Update dispute with selected judges and set status to tribunal
  await db
    .update(disputes)
    .set({
      tribunalAgents: selectedIds,
      status: DISPUTE_STATUS.TRIBUNAL,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, disputeId));

  // Notify selected judges
  for (const judgeId of selectedIds) {
    eventBus.emit(judgeId, {
      type: 'tribunal.selected',
      data: {
        disputeId,
        taskId: dispute.taskId,
        message: 'You have been selected as a tribunal judge',
      },
    });
  }

  return selectedIds;
}

/**
 * Submit a tribunal vote for a dispute.
 *
 * When all 3 votes are in, tallies the result by majority verdict.
 */
export async function submitTribunalVote(
  disputeId: string,
  judgeAgentId: string,
  verdict: string,
  notes: string | null = null,
): Promise<{ resolved: boolean; verdict?: string }> {
  // Fetch the dispute
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);

  if (!dispute) {
    throw new Error(`Dispute ${disputeId} not found`);
  }

  // Verify the judge is part of the tribunal
  const tribunalAgents = dispute.tribunalAgents ?? [];
  if (!tribunalAgents.includes(judgeAgentId)) {
    throw new Error(`Agent ${judgeAgentId} is not a tribunal judge for dispute ${disputeId}`);
  }

  // Record the vote
  const existingVotes = (dispute.tribunalVotes as TribunalVoteRecord) ?? {};
  if (existingVotes[judgeAgentId]) {
    throw new Error(`Agent ${judgeAgentId} has already voted on dispute ${disputeId}`);
  }

  const updatedVotes: TribunalVoteRecord = {
    ...existingVotes,
    [judgeAgentId]: {
      verdict,
      notes,
      timestamp: new Date().toISOString(),
    },
  };

  await db
    .update(disputes)
    .set({
      tribunalVotes: updatedVotes,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, disputeId));

  // Check if all 3 votes are in
  const voteCount = Object.keys(updatedVotes).length;
  if (voteCount < 3) {
    return { resolved: false };
  }

  // Tally the result: majority verdict wins
  const verdictCounts: Record<string, number> = {};
  for (const vote of Object.values(updatedVotes)) {
    verdictCounts[vote.verdict] = (verdictCounts[vote.verdict] ?? 0) + 1;
  }

  let majorityVerdict: string = DISPUTE_VERDICT.SPLIT; // fallback
  let maxVotes = 0;
  for (const [v, c] of Object.entries(verdictCounts)) {
    if (c > maxVotes) {
      maxVotes = c;
      majorityVerdict = v;
    }
  }

  // Resolve the dispute
  await db
    .update(disputes)
    .set({
      verdict: majorityVerdict,
      status: DISPUTE_STATUS.RESOLVED,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, disputeId));

  // Notify involved parties
  eventBus.emit(dispute.raisedByAgentId, {
    type: 'tribunal.resolved',
    data: { disputeId, taskId: dispute.taskId, verdict: majorityVerdict },
  });

  if (dispute.againstAgentId) {
    eventBus.emit(dispute.againstAgentId, {
      type: 'tribunal.resolved',
      data: { disputeId, taskId: dispute.taskId, verdict: majorityVerdict },
    });
  }

  return { resolved: true, verdict: majorityVerdict };
}

/**
 * Determine whether a dispute should be escalated beyond the tribunal.
 *
 * Escalation criteria:
 * - Task amount > $100 (10000 in cents / 10000_000000 in USDC smallest unit)
 * - 2+ prior tribunal failures on this task
 */
export async function shouldEscalate(
  taskId: string,
  amount: bigint,
): Promise<boolean> {
  // High-value threshold: $100 = 100_000_000 in USDC smallest unit (6 decimals)
  // But the spec says > 10000 (cents), so 10000 cents = $100
  // We interpret this as: the raw amount value > 10000
  if (amount > 10000n) {
    return true;
  }

  // Check for repeated tribunal failures on this task
  const priorDisputes = await db
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.taskId, taskId),
        eq(disputes.status, DISPUTE_STATUS.RESOLVED),
      ),
    );

  const failureCount = priorDisputes.length;
  return failureCount >= 2;
}
