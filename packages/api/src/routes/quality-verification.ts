import { Hono } from 'hono';
import { db, type Database } from '../db/client.js';
import { qualityEvaluations, qualityMetrics, tasks } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { PeerReviewSchema } from '@swarmdock/shared';
import * as qualityService from '../services/quality-verification.js';

type QualityVerificationContext = AuthContext & { Variables: AuthContext['Variables'] };

type QualityVerificationDeps = {
  db: Pick<Database, 'select' | 'insert' | 'update'>;
  authMiddleware: typeof authMiddleware;
  requireScope: typeof requireScope;
};

export function createQualityVerificationApp(overrides: Partial<QualityVerificationDeps> = {}) {
  const database = overrides.db ?? db;
  const requireAuth = overrides.authMiddleware ?? authMiddleware;
  const withScope = overrides.requireScope ?? requireScope;
  const app = new Hono<QualityVerificationContext>();

  // GET /api/v1/quality/tasks/:taskId — get quality evaluation for a task
  app.get('/tasks/:taskId', requireAuth, withScope('quality.read'), async (c) => {
    const taskId = c.req.param('taskId');
    const agent = c.get('agent');

    const [task] = await database
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    // Only requester or assignee can view
    if (task.requesterId !== agent.agent_id && task.assigneeId !== agent.agent_id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [evaluation] = await database
      .select()
      .from(qualityEvaluations)
      .where(eq(qualityEvaluations.taskId, taskId))
      .limit(1);

    if (!evaluation) {
      return c.json({ error: 'No quality evaluation exists for this task' }, 404);
    }

    const result = await qualityService.getEvaluation(evaluation.id);
    return c.json(result);
  });

  // POST /api/v1/quality/tasks/:taskId/evaluate — trigger quality pipeline
  app.post('/tasks/:taskId/evaluate', requireAuth, withScope('quality.write'), async (c) => {
    const taskId = c.req.param('taskId');
    const agent = c.get('agent');

    const [task] = await database
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    // Only task requester or assignee can trigger evaluation
    if (task.requesterId !== agent.agent_id && task.assigneeId !== agent.agent_id) {
      return c.json({ error: 'Only the task requester or assignee can trigger evaluation' }, 403);
    }

    // Extract artifacts and optional schema from task or request body
    const body = await c.req.json().catch(() => ({}));
    const artifacts = (body.artifacts ?? task.resultArtifacts ?? []) as Record<string, unknown>[];
    const schema = body.schema as Record<string, unknown> | undefined;
    const requestPeerReview = body.requestPeerReview as boolean | undefined;

    // Create evaluation record
    const [evaluation] = await database
      .insert(qualityEvaluations)
      .values({
        taskId,
        submittedBy: agent.agent_id,
      })
      .returning();

    // Optionally request peer review before running pipeline
    if (requestPeerReview) {
      await qualityService.requestPeerReview(
        evaluation.id,
        taskId,
        body.numReviewers ?? 3,
      );
    }

    // Fire-and-forget the pipeline
    qualityService
      .runQualityPipeline(evaluation.id, task.description, artifacts, schema)
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[quality-verification] Pipeline failed for ${evaluation.id}: ${message}`);
      });

    return c.json(evaluation, 201);
  });

  // POST /api/v1/quality/evaluations/:id/peer-review — submit peer review vote
  app.post('/evaluations/:id/peer-review', requireAuth, withScope('quality.write'), async (c) => {
    const evaluationId = c.req.param('id');
    const agent = c.get('agent');

    const [evaluation] = await database
      .select()
      .from(qualityEvaluations)
      .where(eq(qualityEvaluations.id, evaluationId))
      .limit(1);

    if (!evaluation) {
      return c.json({ error: 'Evaluation not found' }, 404);
    }

    // Only designated peer reviewers can submit
    if (!evaluation.peerReviewers?.includes(agent.agent_id)) {
      return c.json({ error: 'Not a designated peer reviewer for this evaluation' }, 403);
    }

    const body = await c.req.json();
    const parsed = PeerReviewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    try {
      await qualityService.submitPeerReview(
        evaluationId,
        agent.agent_id,
        parsed.data.approved,
        parsed.data.score,
        parsed.data.feedback,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }

    return c.json({ ok: true });
  });

  // GET /api/v1/quality/evaluations/:id — get evaluation detail with metrics
  app.get('/evaluations/:id', requireAuth, withScope('quality.read'), async (c) => {
    const evaluationId = c.req.param('id');
    const agent = c.get('agent');

    const result = await qualityService.getEvaluation(evaluationId);
    if (!result) {
      return c.json({ error: 'Evaluation not found' }, 404);
    }

    // Look up the task to enforce access control
    const [task] = await database
      .select()
      .from(tasks)
      .where(eq(tasks.id, result.taskId))
      .limit(1);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    // Only task requester or assignee can view
    if (task.requesterId !== agent.agent_id && task.assigneeId !== agent.agent_id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json(result);
  });

  return app;
}

export default createQualityVerificationApp();
