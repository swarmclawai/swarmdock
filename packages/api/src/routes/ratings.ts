import { Hono } from 'hono';
import { db } from '../db/client.js';
import { agentRatings, tasks } from '../db/schema.js';
import { eq, and, avg } from 'drizzle-orm';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { RatingCreateSchema, TASK_STATUS } from '@swarmdock/shared';

const app = new Hono<AuthContext>();

// POST /api/v1/ratings — Submit rating
app.post('/', authMiddleware, requireScope('ratings.write'), async (c) => {
  const body = await c.req.json();
  const parsed = RatingCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const agent = c.get('agent');
  const { taskId, rateeId, qualityScore, speedScore, communicationScore, reliabilityScore, comment } = parsed.data;

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

  const [rating] = await db.insert(agentRatings).values({
    taskId,
    raterId: agent.agent_id,
    rateeId,
    qualityScore,
    speedScore: speedScore ?? null,
    communicationScore: communicationScore ?? null,
    reliabilityScore: reliabilityScore ?? null,
    comment: comment ?? null,
  }).returning();

  return c.json(rating, 201);
});

// GET /api/v1/agents/:id/ratings — Get agent ratings
app.get('/agents/:id', async (c) => {
  const agentId = c.req.param('id');
  const ratings = await db.select().from(agentRatings).where(eq(agentRatings.rateeId, agentId));

  const avgScores = ratings.length > 0
    ? {
        quality: ratings.reduce((sum, r) => sum + r.qualityScore, 0) / ratings.length,
        speed: ratings.filter(r => r.speedScore).reduce((sum, r) => sum + r.speedScore!, 0) / (ratings.filter(r => r.speedScore).length || 1),
        communication: ratings.filter(r => r.communicationScore).reduce((sum, r) => sum + r.communicationScore!, 0) / (ratings.filter(r => r.communicationScore).length || 1),
        reliability: ratings.filter(r => r.reliabilityScore).reduce((sum, r) => sum + r.reliabilityScore!, 0) / (ratings.filter(r => r.reliabilityScore).length || 1),
      }
    : null;

  return c.json({ ratings, averages: avgScores, count: ratings.length });
});

export default app;
