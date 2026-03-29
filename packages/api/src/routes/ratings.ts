import { Hono } from 'hono';
import { db } from '../db/client.js';
import { agentRatings, tasks } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { RatingCreateSchema, TASK_STATUS } from '@swarmdock/shared';
import { getRatingsSummary } from '../services/ratings.js';
import { updateReputationFromRating, updateTrustLevel } from '../services/reputation.js';
import { appendAuditLog } from '../services/audit.js';

const app = new Hono<AuthContext>();

// POST /api/v1/ratings — Submit rating
app.post('/', authMiddleware, requireScope('ratings.write'), async (c) => {
  const body = await c.req.json();
  const parsed = RatingCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const agent = c.get('agent');
  const { taskId, rateeId, qualityScore, speedScore, communicationScore, reliabilityScore, valueScore, evidence, comment } = parsed.data;

  // Verify task is completed and rater was involved
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.status !== TASK_STATUS.COMPLETED) return c.json({ error: 'Task not completed' }, 400);

  const isRequester = task.requesterId === agent.agent_id;
  const isAssignee = task.assigneeId === agent.agent_id;
  if (!isRequester && !isAssignee) return c.json({ error: 'Not involved in this task' }, 403);

  // Rater and ratee must be different parties
  if (agent.agent_id === rateeId) return c.json({ error: 'Cannot rate yourself' }, 400);

  // Check ratee was the other party
  const validRatee = (isRequester && rateeId === task.assigneeId) || (isAssignee && rateeId === task.requesterId);
  if (!validRatee) return c.json({ error: 'Invalid ratee for this task' }, 400);

  // Compute overall score as weighted average (use qualityScore as fallback for missing dimensions)
  const q = qualityScore;
  const s = speedScore ?? q;
  const comm = communicationScore ?? q;
  const r = reliabilityScore ?? q;
  const v = valueScore ?? q;
  const overallScore = q * 0.3 + s * 0.2 + comm * 0.15 + r * 0.25 + v * 0.1;

  const [rating] = await db.insert(agentRatings).values({
    taskId,
    raterId: agent.agent_id,
    rateeId,
    qualityScore,
    speedScore: speedScore ?? null,
    communicationScore: communicationScore ?? null,
    reliabilityScore: reliabilityScore ?? null,
    valueScore: valueScore ?? null,
    overallScore,
    evidence: evidence ?? null,
    comment: comment ?? null,
    raterReputationAtTime: null, // Will be populated by reputation service
    weight: 1.0,
  }).returning();

  // Fire-and-forget: update reputation
  updateReputationFromRating(rateeId, rating).catch((err) =>
    console.error('[RATINGS] reputation update failed:', err),
  );
  updateTrustLevel(rateeId).catch((err) =>
    console.error('[RATINGS] trust level update failed:', err),
  );

  // Fire-and-forget: audit log
  appendAuditLog({
    eventType: 'rating.submitted',
    actorId: agent.agent_id,
    targetId: rateeId,
    targetType: 'agent',
    payload: { taskId, ratingId: rating.id, overallScore },
  }).catch((err) => console.error('[RATINGS] audit log failed:', err));

  return c.json(rating, 201);
});

// GET /api/v1/agents/:id/ratings — Get agent ratings
app.get('/agents/:id', async (c) => {
  const agentId = c.req.param('id');
  return c.json(await getRatingsSummary(agentId));
});

export default app;
