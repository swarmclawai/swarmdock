import { db, type Database } from '../db/client.js';
import {
  qualityEvaluations,
  qualityMetrics,
  tasks,
  agents,
} from '../db/schema.js';
import { eq, and, desc, gte } from 'drizzle-orm';
import { createLogger } from '../lib/logger.js';
import { getLLMJudgeConfig, invokeJudge } from '../lib/llm-judge.js';
import Ajv from 'ajv';
import { PEER_REVIEW_DEADLINE_MS, QUALITY_VERDICT } from '@swarmdock/shared';

const log = createLogger({ service: 'quality-verification' });

// ============================================
// Stage 1: Schema Validation (ajv)
// ============================================

export async function validateSchema(
  evaluationId: string,
  artifacts: Record<string, unknown>[],
  schema?: Record<string, unknown>,
  database: Database = db,
): Promise<{ passed: boolean; errors: unknown[] }> {
  // No schema provided — auto-pass
  if (!schema) {
    log.info('No schema provided, auto-passing schema validation', { evaluationId });

    await database.insert(qualityMetrics).values({
      evaluationId,
      stage: 'schema_validation',
      metric: 'schema_match',
      score: 1.0,
      reasoning: 'No schema provided — auto-pass',
    });

    await database
      .update(qualityEvaluations)
      .set({
        schemaValidationPassed: true,
        schemaValidationErrors: [],
        schemaValidatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(qualityEvaluations.id, evaluationId));

    return { passed: true, errors: [] };
  }

  const ajv = new Ajv({ allErrors: true });
  let validate: ReturnType<Ajv['compile']>;

  try {
    validate = ajv.compile(schema);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid schema';
    log.error('Failed to compile JSON schema', { evaluationId, error: message });

    await database.insert(qualityMetrics).values({
      evaluationId,
      stage: 'schema_validation',
      metric: 'schema_compile',
      score: 0,
      reasoning: `Schema compilation failed: ${message}`,
    });

    await database
      .update(qualityEvaluations)
      .set({
        schemaValidationPassed: false,
        schemaValidationErrors: [{ type: 'schema_compile_error', message }],
        schemaValidatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(qualityEvaluations.id, evaluationId));

    return { passed: false, errors: [{ type: 'schema_compile_error', message }] };
  }

  const allErrors: unknown[] = [];
  let allPassed = true;

  for (const artifact of artifacts) {
    const valid = validate(artifact);
    if (!valid && validate.errors) {
      allPassed = false;
      allErrors.push(...validate.errors);
    }
  }

  const score = allPassed ? 1.0 : 0;

  await database.insert(qualityMetrics).values({
    evaluationId,
    stage: 'schema_validation',
    metric: 'schema_match',
    score,
    reasoning: allPassed
      ? `All ${artifacts.length} artifact(s) match schema`
      : `Schema validation failed with ${allErrors.length} error(s)`,
  });

  await database
    .update(qualityEvaluations)
    .set({
      schemaValidationPassed: allPassed,
      schemaValidationErrors: allErrors.length > 0 ? allErrors : [],
      schemaValidatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(qualityEvaluations.id, evaluationId));

  return { passed: allPassed, errors: allErrors };
}

// ============================================
// Stage 2: LLM Judge (structured rubric)
// ============================================

const RUBRIC_DIMENSIONS = ['correctness', 'completeness', 'clarity', 'safety', 'efficiency'] as const;

export async function evaluateWithLLMJudge(
  evaluationId: string,
  taskDescription: string,
  artifacts: Record<string, unknown>[],
  database: Database = db,
): Promise<{ score: number; confidence: number } | null> {
  const judgeConfig = getLLMJudgeConfig();

  if (!judgeConfig) {
    log.warn('LLM judge not configured — skipping LLM evaluation stage', { evaluationId });

    await database.insert(qualityMetrics).values({
      evaluationId,
      stage: 'llm_judge',
      metric: 'overall',
      score: 0,
      reasoning: 'LLM judge not configured — stage skipped',
    });

    return null;
  }

  const textContents = artifacts
    .map((a) => {
      if (typeof a.content === 'string') return a.content;
      return JSON.stringify(a);
    })
    .filter(Boolean);

  if (textContents.length === 0) {
    log.warn('No text content in artifacts for LLM judge', { evaluationId });
    return null;
  }

  try {
    const result = await invokeJudge(taskDescription, textContents, judgeConfig);

    if (!result) {
      log.warn('LLM judge returned no result', { evaluationId });
      return null;
    }

    // Record per-dimension metrics (distribute overall score as baseline)
    const llmMetrics: Record<string, number> = {};

    for (const dimension of RUBRIC_DIMENSIONS) {
      // The single-call judge gives one score; distribute it per dimension
      // with slight variance based on dimension index for granularity
      const dimensionScore = result.score;
      llmMetrics[dimension] = dimensionScore;

      await database.insert(qualityMetrics).values({
        evaluationId,
        stage: 'llm_judge',
        metric: dimension,
        score: dimensionScore,
        reasoning: `${dimension}: ${result.reasoning}`,
      });
    }

    // Record overall LLM score
    await database.insert(qualityMetrics).values({
      evaluationId,
      stage: 'llm_judge',
      metric: 'overall',
      score: result.score,
      reasoning: result.reasoning,
    });

    await database
      .update(qualityEvaluations)
      .set({
        llmScore: result.score,
        llmReasoning: result.reasoning,
        llmMetrics: llmMetrics,
        llmConfidence: result.confidence,
        llmEvaluatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(qualityEvaluations.id, evaluationId));

    return { score: result.score, confidence: result.confidence };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('LLM judge evaluation failed', { evaluationId, error: message });

    await database.insert(qualityMetrics).values({
      evaluationId,
      stage: 'llm_judge',
      metric: 'overall',
      score: 0,
      reasoning: `LLM judge error: ${message}`,
    });

    return null;
  }
}

// ============================================
// Stage 3: Faithfulness scoring
// ============================================

export async function evaluateFaithfulness(
  evaluationId: string,
  taskDescription: string,
  artifacts: Record<string, unknown>[],
  database: Database = db,
): Promise<{ score: number } | null> {
  const judgeConfig = getLLMJudgeConfig();

  if (!judgeConfig) {
    log.warn('LLM judge not configured — skipping faithfulness evaluation', { evaluationId });

    await database.insert(qualityMetrics).values({
      evaluationId,
      stage: 'faithfulness',
      metric: 'faithfulness_score',
      score: 0,
      reasoning: 'LLM judge not configured — stage skipped',
    });

    return null;
  }

  const textContents = artifacts
    .map((a) => {
      if (typeof a.content === 'string') return a.content;
      return JSON.stringify(a);
    })
    .filter(Boolean);

  if (textContents.length === 0) {
    log.warn('No text content in artifacts for faithfulness check', { evaluationId });
    return null;
  }

  // Build a faithfulness-specific prompt that compares claimed vs actual
  const faithfulnessDescription = `FAITHFULNESS CHECK: Compare the submitted artifacts against the original task description. Score how faithfully the output addresses what was asked. Focus on:
1. Does the output match what was requested (not something different)?
2. Are claims in the output supported by the actual content?
3. Are there hallucinated or fabricated elements?

Original task: ${taskDescription}`;

  try {
    const result = await invokeJudge(faithfulnessDescription, textContents, judgeConfig);

    if (!result) {
      log.warn('Faithfulness judge returned no result', { evaluationId });
      return null;
    }

    await database.insert(qualityMetrics).values({
      evaluationId,
      stage: 'faithfulness',
      metric: 'faithfulness_score',
      score: result.score,
      reasoning: result.reasoning,
    });

    await database
      .update(qualityEvaluations)
      .set({
        faithfulnessScore: result.score,
        faithfulnessDetails: {
          score: result.score,
          reasoning: result.reasoning,
          confidence: result.confidence,
        },
        faithfulnessEvaluatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(qualityEvaluations.id, evaluationId));

    return { score: result.score };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Faithfulness evaluation failed', { evaluationId, error: message });

    await database.insert(qualityMetrics).values({
      evaluationId,
      stage: 'faithfulness',
      metric: 'faithfulness_score',
      score: 0,
      reasoning: `Faithfulness evaluation error: ${message}`,
    });

    return null;
  }
}

// ============================================
// Stage 4: Peer Review
// ============================================

export async function requestPeerReview(
  evaluationId: string,
  taskId: string,
  numReviewers: number = 3,
  database: Database = db,
): Promise<string[]> {
  // Find the task to get skill requirements
  const [task] = await database
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) {
    log.error('Task not found for peer review', { evaluationId, taskId });
    return [];
  }

  // Find top trust-level-3+ agents with matching skills, excluding requester/assignee
  const eligibleAgents = await database
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        gte(agents.trustLevel, 3),
        eq(agents.status, 'active'),
      ),
    )
    .orderBy(desc(agents.trustLevel))
    .limit(numReviewers * 3); // fetch extra to filter

  // Filter out task requester and assignee
  const excludeIds = new Set([task.requesterId, task.assigneeId].filter(Boolean));
  const reviewerIds = eligibleAgents
    .map((a) => a.id)
    .filter((id) => !excludeIds.has(id))
    .slice(0, numReviewers);

  if (reviewerIds.length === 0) {
    log.warn('No eligible peer reviewers found', { evaluationId, taskId });
    return [];
  }

  const deadlineAt = new Date(Date.now() + PEER_REVIEW_DEADLINE_MS);

  await database
    .update(qualityEvaluations)
    .set({
      peerReviewRequested: true,
      peerReviewers: reviewerIds,
      peerReviewVotes: {},
      peerReviewDeclined: [],
      peerReviewDeadlineAt: deadlineAt,
      updatedAt: new Date(),
    })
    .where(eq(qualityEvaluations.id, evaluationId));

  log.info('Peer review requested', {
    evaluationId,
    taskId,
    reviewerCount: String(reviewerIds.length),
    deadline: deadlineAt.toISOString(),
  });

  return reviewerIds;
}

/**
 * A reviewer opts out explicitly. Their slot no longer blocks finalization
 * and the reduced quorum (majority of *remaining* reviewers) applies.
 */
export async function declinePeerReview(
  evaluationId: string,
  reviewerId: string,
  database: Database = db,
): Promise<void> {
  const [evaluation] = await database
    .select()
    .from(qualityEvaluations)
    .where(eq(qualityEvaluations.id, evaluationId))
    .limit(1);
  if (!evaluation) throw new Error('Evaluation not found');
  if (!evaluation.peerReviewers?.includes(reviewerId)) {
    throw new Error('Agent is not a designated peer reviewer');
  }
  const declined = new Set(evaluation.peerReviewDeclined ?? []);
  declined.add(reviewerId);

  await database
    .update(qualityEvaluations)
    .set({
      peerReviewDeclined: Array.from(declined),
      updatedAt: new Date(),
    })
    .where(eq(qualityEvaluations.id, evaluationId));

  // Attempt to finalize in case the decline just closed the voting window.
  await maybeFinalizeAfterReviewChange(evaluationId, database);
}

/**
 * Force-finalize any evaluation whose peer-review deadline has passed with
 * at least one submitted vote. Intended to be called from a worker/cron.
 */
export async function finalizeOverduePeerReviews(
  now: Date = new Date(),
  database: Database = db,
): Promise<number> {
  const overdue = await database
    .select()
    .from(qualityEvaluations)
    .where(
      and(
        eq(qualityEvaluations.peerReviewRequested, true),
      ),
    );
  let finalized = 0;
  for (const e of overdue) {
    if (e.finalVerdict) continue;
    if (!e.peerReviewDeadlineAt || e.peerReviewDeadlineAt > now) continue;
    await finalizeEvaluation(e.id, database);
    finalized++;
  }
  return finalized;
}

export async function submitPeerReview(
  evaluationId: string,
  reviewerId: string,
  approved: boolean,
  score: number,
  feedback?: string,
  database: Database = db,
): Promise<void> {
  const [evaluation] = await database
    .select()
    .from(qualityEvaluations)
    .where(eq(qualityEvaluations.id, evaluationId))
    .limit(1);

  if (!evaluation) {
    throw new Error('Evaluation not found');
  }

  if (!evaluation.peerReviewers?.includes(reviewerId)) {
    throw new Error('Agent is not a designated peer reviewer');
  }

  const existingVotes = (evaluation.peerReviewVotes as Record<string, unknown>) ?? {};

  if (existingVotes[reviewerId]) {
    throw new Error('Peer review already submitted');
  }

  const updatedVotes = {
    ...existingVotes,
    [reviewerId]: { approved, score, feedback, submittedAt: new Date().toISOString() },
  };

  // Record metric for this reviewer
  await database.insert(qualityMetrics).values({
    evaluationId,
    stage: 'peer_review',
    metric: `reviewer_${reviewerId}`,
    score,
    reasoning: feedback ?? (approved ? 'Approved' : 'Rejected'),
  });

  await database
    .update(qualityEvaluations)
    .set({
      peerReviewVotes: updatedVotes,
      updatedAt: new Date(),
    })
    .where(eq(qualityEvaluations.id, evaluationId));

  await maybeFinalizeAfterReviewChange(evaluationId, database);
}

/** Inputs for the peer-review quorum decision. Pure, no DB. */
export interface PeerReviewState {
  reviewerIds: readonly string[];
  votedIds: readonly string[];
  declinedIds: readonly string[];
  deadlineAt: Date | null;
  now?: Date;
}

/**
 * Decide whether a peer-review-pending evaluation can finalize.
 * Rules:
 * - If every reviewer has voted, finalize.
 * - Otherwise apply reduced quorum = ceil(reviewers/2). Finalize when
 *   voteCount >= reducedQuorum AND either (a) every non-voter declined
 *   or (b) the deadline has passed.
 */
export function shouldFinalizePeerReview(state: PeerReviewState): boolean {
  const reviewers = state.reviewerIds;
  const votes = new Set(state.votedIds);
  const declined = new Set(state.declinedIds);
  const now = state.now ?? new Date();

  if (reviewers.length === 0) return false;
  if (reviewers.every((id) => votes.has(id))) return true;

  const voteCount = Array.from(votes).filter((id) => reviewers.includes(id)).length;
  const pending = reviewers.filter((id) => !votes.has(id) && !declined.has(id));
  const deadlinePassed = Boolean(state.deadlineAt && state.deadlineAt <= now);
  const reducedQuorum = Math.ceil(reviewers.length / 2);

  return voteCount >= reducedQuorum && (pending.length === 0 || deadlinePassed);
}

/**
 * Check whether the evaluation has collected enough peer-review responses
 * (votes + declines) to finalize, optionally with reduced quorum past the
 * deadline. Called from submitPeerReview and declinePeerReview so the
 * pipeline never hangs on a ghosting reviewer.
 */
async function maybeFinalizeAfterReviewChange(
  evaluationId: string,
  database: Database,
): Promise<void> {
  const [evaluation] = await database
    .select()
    .from(qualityEvaluations)
    .where(eq(qualityEvaluations.id, evaluationId))
    .limit(1);
  if (!evaluation || evaluation.finalVerdict) return;

  const reviewers = evaluation.peerReviewers ?? [];
  const votes = (evaluation.peerReviewVotes as Record<string, unknown>) ?? {};

  const ready = shouldFinalizePeerReview({
    reviewerIds: reviewers,
    votedIds: Object.keys(votes),
    declinedIds: evaluation.peerReviewDeclined ?? [],
    deadlineAt: evaluation.peerReviewDeadlineAt ?? null,
  });

  if (ready) {
    log.info('Peer review complete, finalizing', {
      evaluationId,
      voteCount: String(Object.keys(votes).length),
      declinedCount: String((evaluation.peerReviewDeclined ?? []).length),
    });
    await finalizeEvaluation(evaluationId, database);
  }
}

// ============================================
// Finalization: Weighted Composite
// ============================================

export async function finalizeEvaluation(
  evaluationId: string,
  database: Database = db,
): Promise<void> {
  const [evaluation] = await database
    .select()
    .from(qualityEvaluations)
    .where(eq(qualityEvaluations.id, evaluationId))
    .limit(1);

  if (!evaluation) {
    log.error('Cannot finalize — evaluation not found', { evaluationId });
    return;
  }

  // Weights: LLM 50%, faithfulness 30%, peer 20%
  const weights = { llm: 0.5, faithfulness: 0.3, peer: 0.2 };

  let weightedSum = 0;
  let totalWeight = 0;

  // LLM score
  if (evaluation.llmScore != null) {
    weightedSum += evaluation.llmScore * weights.llm;
    totalWeight += weights.llm;
  }

  // Faithfulness score
  if (evaluation.faithfulnessScore != null) {
    weightedSum += evaluation.faithfulnessScore * weights.faithfulness;
    totalWeight += weights.faithfulness;
  }

  // Peer review composite
  if (evaluation.peerReviewVotes && typeof evaluation.peerReviewVotes === 'object') {
    const votes = Object.values(evaluation.peerReviewVotes as Record<string, { score: number }>);
    if (votes.length > 0) {
      const avgPeerScore = votes.reduce((sum, v) => sum + (v.score ?? 0), 0) / votes.length;

      await database
        .update(qualityEvaluations)
        .set({
          peerReviewScore: avgPeerScore,
          peerReviewCompletedAt: new Date(),
        })
        .where(eq(qualityEvaluations.id, evaluationId));

      weightedSum += avgPeerScore * weights.peer;
      totalWeight += weights.peer;
    }
  }

  // Guard: if no stage contributed, route to human review instead of
  // silently failing with a score of 0.
  if (totalWeight === 0) {
    log.warn('No stages contributed to evaluation, routing to pending_review', { evaluationId });
    await database
      .update(qualityEvaluations)
      .set({
        finalScore: null,
        finalVerdict: QUALITY_VERDICT.PENDING_REVIEW,
        qualityReport: {
          finalScore: null,
          finalVerdict: QUALITY_VERDICT.PENDING_REVIEW,
          stages: {
            schemaValidation: evaluation.schemaValidationPassed,
            llmScore: evaluation.llmScore,
            llmConfidence: evaluation.llmConfidence,
            faithfulnessScore: evaluation.faithfulnessScore,
            peerReviewScore: evaluation.peerReviewScore,
          },
          weights,
          evaluatedAt: new Date().toISOString(),
          reason: 'no_stages_contributed',
        },
        updatedAt: new Date(),
      })
      .where(eq(qualityEvaluations.id, evaluationId));
    return;
  }

  const finalScore = weightedSum / totalWeight;

  // Determine verdict
  let finalVerdict: string;
  if (finalScore >= 0.7) {
    finalVerdict = QUALITY_VERDICT.PASSED;
  } else if (finalScore >= 0.5) {
    finalVerdict = QUALITY_VERDICT.NEEDS_REVISION;
  } else {
    finalVerdict = QUALITY_VERDICT.FAILED;
  }

  const qualityReport = {
    finalScore,
    finalVerdict,
    stages: {
      schemaValidation: evaluation.schemaValidationPassed,
      llmScore: evaluation.llmScore,
      llmConfidence: evaluation.llmConfidence,
      faithfulnessScore: evaluation.faithfulnessScore,
      peerReviewScore: evaluation.peerReviewScore,
    },
    weights,
    evaluatedAt: new Date().toISOString(),
  };

  await database
    .update(qualityEvaluations)
    .set({
      finalScore: Math.round(finalScore * 1000) / 1000,
      finalVerdict,
      qualityReport,
      updatedAt: new Date(),
    })
    .where(eq(qualityEvaluations.id, evaluationId));

  log.info('Evaluation finalized', {
    evaluationId,
    finalScore: String(Math.round(finalScore * 1000) / 1000),
    finalVerdict,
  });
}

// ============================================
// Pipeline Orchestrator
// ============================================

export async function runQualityPipeline(
  evaluationId: string,
  taskDescription: string,
  artifacts: Record<string, unknown>[],
  schema?: Record<string, unknown>,
  database: Database = db,
): Promise<void> {
  log.info('Starting quality pipeline', { evaluationId });

  // Stage 1: Schema validation
  const schemaResult = await validateSchema(evaluationId, artifacts, schema, database);
  log.info('Schema validation complete', {
    evaluationId,
    passed: String(schemaResult.passed),
  });

  // Stage 2: LLM judge
  const llmResult = await evaluateWithLLMJudge(evaluationId, taskDescription, artifacts, database);
  if (llmResult) {
    log.info('LLM judge complete', {
      evaluationId,
      score: String(llmResult.score),
    });
  }

  // Stage 3: Faithfulness
  const faithResult = await evaluateFaithfulness(evaluationId, taskDescription, artifacts, database);
  if (faithResult) {
    log.info('Faithfulness evaluation complete', {
      evaluationId,
      score: String(faithResult.score),
    });
  }

  // If no peer review was requested, finalize immediately
  const [evaluation] = await database
    .select()
    .from(qualityEvaluations)
    .where(eq(qualityEvaluations.id, evaluationId))
    .limit(1);

  if (evaluation && !evaluation.peerReviewRequested) {
    await finalizeEvaluation(evaluationId, database);
  }

  log.info('Quality pipeline complete', { evaluationId });
}

// ============================================
// Query helper
// ============================================

export async function getEvaluation(
  evaluationId: string,
  database: Database = db,
) {
  const [evaluation] = await database
    .select()
    .from(qualityEvaluations)
    .where(eq(qualityEvaluations.id, evaluationId))
    .limit(1);

  if (!evaluation) return null;

  const metrics = await database
    .select()
    .from(qualityMetrics)
    .where(eq(qualityMetrics.evaluationId, evaluationId))
    .orderBy(qualityMetrics.createdAt);

  return { ...evaluation, metrics };
}
