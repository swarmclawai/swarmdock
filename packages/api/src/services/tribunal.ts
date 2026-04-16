import { db } from '../db/client.js';
import { disputes, agentReputation, agents } from '../db/schema.js';
import { eq, and, ne, sql } from 'drizzle-orm';
import { DISPUTE_STATUS, DISPUTE_VERDICT } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import type { Database } from '../db/client.js';

type TribunalVoteRecord = Record<
  string,
  { verdict: string; notes: string | null; timestamp: string }
>;

type TribunalDb = Pick<Database, 'select'>;

export const HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC = 100_000_000n;

export function isHighValueDispute(amount: bigint): boolean {
  return amount > HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC;
}

/**
 * Tally tribunal votes into a single verdict.
 * Returns SPLIT when no single verdict has a strict plurality
 * (e.g. all three judges pick different verdicts, or two verdicts tie).
 */
export function tallyTribunalVotes(verdicts: string[]): string {
  if (verdicts.length === 0) return DISPUTE_VERDICT.SPLIT;
  const counts: Record<string, number> = {};
  for (const v of verdicts) {
    counts[v] = (counts[v] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    // Top two are tied — no plurality winner
    return DISPUTE_VERDICT.SPLIT;
  }
  return sorted[0][0];
}

/**
 * Select 3 random high-reputation agents to serve as tribunal judges.
 *
 * Requirements:
 * - Not involved in the dispute (not raisedBy or against)
 * - trust_level >= 2
 * - quality reputation score > 0.6
 *
 * When fewer than 3 eligible judges exist, the dispute is marked
 * `admin_required` instead of throwing — a human admin can resolve it
 * via the admin dispute-resolution endpoint.
 */
export async function selectTribunalJudges(
  disputeId: string,
  options: { exclude?: readonly string[] } = {},
): Promise<string[]> {
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
  const excludedIds = new Set<string>([
    ...[dispute.raisedByAgentId, dispute.againstAgentId].filter((id): id is string => id != null),
    ...(options.exclude ?? []),
  ]);

  const eligibleRows = await db
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
        ...Array.from(excludedIds).map((id) => ne(agents.id, id)),
      ),
    );

  const eligible = eligibleRows
    .map((row) => row.agentId)
    .filter((id): id is string => typeof id === 'string');

  if (eligible.length < 3) {
    // Graceful fallback: mark admin_required and emit an event so the
    // admin surface can pick this up. Callers who set --force strict
    // behavior can still throw; defaults route to human review.
    await db
      .update(disputes)
      .set({
        status: DISPUTE_STATUS.ADMIN_REQUIRED,
        updatedAt: new Date(),
      })
      .where(eq(disputes.id, disputeId));

    eventBus.broadcast({
      type: 'dispute.admin_required',
      data: {
        disputeId,
        taskId: dispute.taskId,
        eligibleJudges: eligible.length,
        reason: 'insufficient_judges',
      },
    });

    return [];
  }

  // Random selection of 3 judges
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  const selectedIds = shuffled.slice(0, 3);

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
 * Judge-initiated decline. Removes the judge from the tribunal roster and
 * attempts to recruit a replacement. If no replacement is available, the
 * dispute flips to admin_required.
 */
export async function declineTribunal(
  disputeId: string,
  judgeAgentId: string,
  notes: string | null = null,
): Promise<{ replaced: string | null; adminRequired: boolean }> {
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);

  if (!dispute) throw new Error(`Dispute ${disputeId} not found`);

  const roster = dispute.tribunalAgents ?? [];
  if (!roster.includes(judgeAgentId)) {
    throw new Error(`Agent ${judgeAgentId} is not a tribunal judge for dispute ${disputeId}`);
  }

  const existingVotes = (dispute.tribunalVotes as TribunalVoteRecord) ?? {};
  if (existingVotes[judgeAgentId]) {
    throw new Error(`Agent ${judgeAgentId} has already voted on dispute ${disputeId}`);
  }

  // Pick a replacement excluding the current roster (including the decliner).
  const replacements = await db
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
        ne(agents.id, judgeAgentId),
        ...roster
          .filter((id): id is string => typeof id === 'string' && id !== judgeAgentId)
          .map((id) => ne(agents.id, id)),
        ...[dispute.raisedByAgentId, dispute.againstAgentId]
          .filter((id): id is string => typeof id === 'string')
          .map((id) => ne(agents.id, id)),
      ),
    )
    .limit(1);

  const replacement = replacements[0]?.agentId ?? null;
  const nextRoster = roster.filter((id) => id !== judgeAgentId);
  if (replacement) nextRoster.push(replacement);

  await db
    .update(disputes)
    .set({
      tribunalAgents: nextRoster,
      status: replacement ? DISPUTE_STATUS.TRIBUNAL : DISPUTE_STATUS.ADMIN_REQUIRED,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, disputeId));

  eventBus.broadcast({
    type: 'tribunal.declined',
    data: { disputeId, taskId: dispute.taskId, declinedBy: judgeAgentId, replacement, notes },
  });

  if (replacement) {
    eventBus.emit(replacement, {
      type: 'tribunal.selected',
      data: {
        disputeId,
        taskId: dispute.taskId,
        message: 'You have been selected as a tribunal judge (replacement)',
      },
    });
  }

  return { replaced: replacement, adminRequired: !replacement };
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

  // Defense-in-depth: reject self-votes even if the selection pool somehow
  // leaked an involved party (e.g. replacement pool drift, admin manual add).
  if (
    judgeAgentId === dispute.raisedByAgentId ||
    judgeAgentId === dispute.againstAgentId
  ) {
    throw new Error(`Agent ${judgeAgentId} is a party to dispute ${disputeId} and cannot vote`);
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

  // Tally the result: plurality verdict wins; ties fall back to SPLIT
  const majorityVerdict = tallyTribunalVotes(
    Object.values(updatedVotes).map((vote) => vote.verdict),
  );

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
  database: TribunalDb = db,
): Promise<boolean> {
  if (isHighValueDispute(amount)) {
    return true;
  }

  // Check for repeated tribunal failures on this task
  const priorDisputes = await database
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
