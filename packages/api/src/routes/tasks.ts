import { Hono } from 'hono';
import { db } from '../db/client.js';
import { tasks, taskBids, agents } from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import {
  TaskCreateSchema, TaskUpdateSchema, TaskSubmitSchema, TaskListQuerySchema,
  TASK_STATUS, BID_STATUS, AGENT_STATUS,
} from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import { releaseEscrow, refundEscrow } from '../services/escrow.js';
import { embed } from '../services/embeddings.js';

const app = new Hono<AuthContext>();

// GET /api/v1/tasks — List/search tasks
app.get('/', async (c) => {
  const query = TaskListQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query', details: query.error.flatten() }, 400);
  }

  const { status, skills, budgetMin, budgetMax, requesterId, assigneeId, limit, offset } = query.data;

  let q = db.select().from(tasks).$dynamic();

  const conditions = [];
  if (status) conditions.push(eq(tasks.status, status));
  if (requesterId) conditions.push(eq(tasks.requesterId, requesterId));
  if (assigneeId) conditions.push(eq(tasks.assigneeId, assigneeId));

  if (conditions.length > 0) {
    q = q.where(and(...conditions));
  }

  const result = await q.limit(limit).offset(offset);
  return c.json({ tasks: result, limit, offset });
});

// POST /api/v1/tasks — Create task
app.post('/', authMiddleware, requireScope('tasks.write'), async (c) => {
  const body = await c.req.json();
  const parsed = TaskCreateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const agent = c.get('agent');
  const { title, description, skillRequirements, inputData, matchingMode, budgetMin, budgetMax, deadline, directAssigneeId } = parsed.data;

  const [task] = await db.insert(tasks).values({
    requesterId: agent.agent_id,
    assigneeId: directAssigneeId ?? null,
    title,
    description,
    skillRequirements,
    inputData: inputData ?? null,
    matchingMode,
    budgetMin: budgetMin ? BigInt(budgetMin) : null,
    budgetMax: BigInt(budgetMax),
    deadline: deadline ? new Date(deadline) : null,
    status: directAssigneeId ? TASK_STATUS.ASSIGNED : TASK_STATUS.OPEN,
  }).returning();

  // Broadcast to all connected agents
  eventBus.broadcast({
    type: 'task.created',
    data: {
      taskId: task.id,
      title: task.title,
      skillRequirements,
      budgetMax: budgetMax,
      matchingMode,
    },
  });

  // Async embed (don't block response)
  embed(description).then(async (vec) => {
    await db.update(tasks).set({ descriptionEmbedding: vec }).where(eq(tasks.id, task.id));
  }).catch(console.error);

  return c.json(task, 201);
});

// GET /api/v1/tasks/:id — Task detail
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const bids = await db.select().from(taskBids).where(eq(taskBids.taskId, id));

  return c.json({ ...task, bids, bidCount: bids.length });
});

// PATCH /api/v1/tasks/:id — Update task (owner only)
app.patch('/:id', authMiddleware, requireScope('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requesterId !== agent.agent_id) return c.json({ error: 'Not task owner' }, 403);
  if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
    return c.json({ error: 'Cannot update task in current status' }, 400);
  }

  const body = await c.req.json();
  const parsed = TaskUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.deadline) {
    updateData.deadline = new Date(parsed.data.deadline);
  }

  const [updated] = await db
    .update(tasks)
    .set(updateData)
    .where(eq(tasks.id, id))
    .returning();

  return c.json(updated);
});

// DELETE /api/v1/tasks/:id — Cancel task
app.delete('/:id', authMiddleware, requireScope('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requesterId !== agent.agent_id) return c.json({ error: 'Not task owner' }, 403);
  if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
    return c.json({ error: 'Cannot cancel task in current status' }, 400);
  }

  await db.update(tasks).set({ status: TASK_STATUS.CANCELLED, updatedAt: new Date() }).where(eq(tasks.id, id));

  // Refund escrow if any
  await refundEscrow(id);

  return c.json({ message: 'Task cancelled' });
});

// POST /api/v1/tasks/:id/start — Agent starts work
app.post('/:id/start', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.assigneeId !== agent.agent_id) return c.json({ error: 'Not assigned to this task' }, 403);
  if (task.status !== TASK_STATUS.ASSIGNED) return c.json({ error: 'Task not in assigned status' }, 400);

  const [updated] = await db.update(tasks).set({
    status: TASK_STATUS.IN_PROGRESS,
    startedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(tasks.id, id)).returning();

  eventBus.emit(task.requesterId, {
    type: 'task.started',
    data: { taskId: id, agentId: agent.agent_id },
  });

  return c.json(updated);
});

// POST /api/v1/tasks/:id/submit — Submit results
app.post('/:id/submit', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.assigneeId !== agent.agent_id) return c.json({ error: 'Not assigned to this task' }, 403);
  if (task.status !== TASK_STATUS.IN_PROGRESS) return c.json({ error: 'Task not in progress' }, 400);

  const body = await c.req.json();
  const parsed = TaskSubmitSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const [updated] = await db.update(tasks).set({
    status: TASK_STATUS.REVIEW,
    resultArtifacts: parsed.data.artifacts,
    resultFiles: parsed.data.files,
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(tasks.id, id)).returning();

  eventBus.emit(task.requesterId, {
    type: 'task.submitted',
    data: { taskId: id, agentId: agent.agent_id, artifacts: parsed.data.artifacts },
  });

  return c.json(updated);
});

// POST /api/v1/tasks/:id/approve — Approve and release payment
app.post('/:id/approve', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requesterId !== agent.agent_id) return c.json({ error: 'Not task owner' }, 403);
  if (task.status !== TASK_STATUS.REVIEW) return c.json({ error: 'Task not in review status' }, 400);

  // Release escrow
  const { releaseTxHash, fee } = await releaseEscrow(id);

  const [updated] = await db.update(tasks).set({
    status: TASK_STATUS.COMPLETED,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(tasks.id, id)).returning();

  if (task.assigneeId) {
    eventBus.emit(task.assigneeId, {
      type: 'task.completed',
      data: { taskId: id, releaseTxHash, fee: fee.toString() },
    });
  }

  return c.json({ ...updated, releaseTxHash });
});

// POST /api/v1/tasks/:id/reject — Reject submission
app.post('/:id/reject', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requesterId !== agent.agent_id) return c.json({ error: 'Not task owner' }, 403);
  if (task.status !== TASK_STATUS.REVIEW) return c.json({ error: 'Task not in review status' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const reason = (body as { reason?: string }).reason ?? 'No reason provided';

  const [updated] = await db.update(tasks).set({
    status: TASK_STATUS.IN_PROGRESS,
    resultArtifacts: null,
    resultFiles: null,
    submittedAt: null,
    updatedAt: new Date(),
  }).where(eq(tasks.id, id)).returning();

  if (task.assigneeId) {
    eventBus.emit(task.assigneeId, {
      type: 'task.rejected',
      data: { taskId: id, reason },
    });
  }

  return c.json(updated);
});

export default app;
