import { Hono } from 'hono';
import { db } from '../db/client.js';
import { tasks, taskBids, agents, disputes } from '../db/schema.js';
import { eq, and, inArray, sql, count, gte, lte, ilike, or, desc } from 'drizzle-orm';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import {
  TaskCreateSchema, TaskUpdateSchema, TaskSubmitSchema, TaskListQuerySchema, TaskDisputeSchema,
  TASK_STATUS,
  DISPUTE_STATUS,
} from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import { releaseEscrow, refundEscrow } from '../services/escrow.js';
import { verifyTaskOutput } from '../services/quality.js';
import { appendAuditLog } from '../services/audit.js';
import { embed } from '../services/embeddings.js';
import { persistTaskSubmission } from '../services/storage.js';
import { fetchOrderedRowsByIds, searchTasksIndex } from '../services/search.js';

const app = new Hono<AuthContext>();

// GET /api/v1/tasks — List/search tasks
app.get('/', async (c) => {
  const query = TaskListQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query', details: query.error.flatten() }, 400);
  }

  const { q, status, skills, budgetMin, budgetMax, requesterId, assigneeId, limit, offset } = query.data;

  if (!budgetMin && !budgetMax) {
    const indexed = await searchTasksIndex({
      q,
      status,
      skills,
      requesterId,
      assigneeId,
      limit,
      offset,
    });

    if (indexed) {
      if (indexed.ids.length === 0) {
        return c.json({ tasks: [], limit, offset, total: indexed.total, facets: indexed.facets });
      }

      const result = await fetchOrderedRowsByIds(indexed.ids, () =>
        db
          .select()
          .from(tasks)
          .where(inArray(tasks.id, indexed.ids)),
      );

      const bidCountRows = await db.execute(sql`
        SELECT ${taskBids.taskId} AS task_id, COUNT(*)::int AS bid_count
        FROM ${taskBids}
        WHERE ${taskBids.taskId} IN (${sql.join(indexed.ids.map((id: string) => sql`${id}`), sql`, `)})
        GROUP BY ${taskBids.taskId}
      `);

      const bidCountEntries = (bidCountRows.rows as Array<{ task_id: string; bid_count: number | string }>)
        .map((row) => [row.task_id, Number(row.bid_count)] as const);
      const bidCounts = new Map<string, number>(bidCountEntries);

      return c.json({
        tasks: result.map((task) => ({
          ...task,
          bidCount: bidCounts.get(task.id) ?? 0,
        })),
        limit,
        offset,
        total: indexed.total,
        facets: indexed.facets,
      });
    }
  }

  const conditions = [];
  if (status) conditions.push(eq(tasks.status, status));
  if (requesterId) conditions.push(eq(tasks.requesterId, requesterId));
  if (assigneeId) conditions.push(eq(tasks.assigneeId, assigneeId));
  if (q?.trim()) {
    const pattern = `%${q.trim()}%`;
    conditions.push(or(
      ilike(tasks.title, pattern),
      ilike(tasks.description, pattern),
    )!);
  }
  if (skills) {
    const skillList = skills
      .split(',')
      .map((skill) => skill.trim().toLowerCase())
      .filter(Boolean);
    if (skillList.length > 0) {
      conditions.push(sql`
        EXISTS (
          SELECT 1
          FROM unnest(${tasks.skillRequirements}) AS skill
          WHERE LOWER(skill) = ANY(${skillList})
        )
      `);
    }
  }
  if (budgetMin) {
    conditions.push(gte(tasks.budgetMax, BigInt(budgetMin)));
  }
  if (budgetMax) {
    conditions.push(lte(sql`COALESCE(${tasks.budgetMin}, ${tasks.budgetMax})`, BigInt(budgetMax)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(tasks).where(whereClause);
  const result = await db.select().from(tasks).where(whereClause).limit(limit).offset(offset);

  const taskIds = result.map((task) => task.id);
  const bidCountRows = taskIds.length > 0
    ? await db.execute(sql`
      SELECT ${taskBids.taskId} AS task_id, COUNT(*)::int AS bid_count
      FROM ${taskBids}
      WHERE ${taskBids.taskId} IN (${sql.join(taskIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY ${taskBids.taskId}
    `)
    : { rows: [] as Array<{ task_id: string; bid_count: number | string }> };

  const bidCountEntries = (bidCountRows.rows as Array<{ task_id: string; bid_count: number | string }>)
    .map((row) => [row.task_id, Number(row.bid_count)] as const);
  const bidCounts = new Map<string, number>(bidCountEntries);

  return c.json({
    tasks: result.map((task) => ({
      ...task,
      bidCount: bidCounts.get(task.id) ?? 0,
    })),
    limit,
    offset,
    total: Number(total),
  });
});

// POST /api/v1/tasks — Create task
app.post('/', authMiddleware, requireScope('tasks.write'), async (c) => {
  const body = await c.req.json();
  const parsed = TaskCreateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const agent = c.get('agent');
  const { title, description, skillRequirements, inputData, inputFiles, matchingMode, budgetMin, budgetMax, deadline, directAssigneeId } = parsed.data;

  const [task] = await db.insert(tasks).values({
    requesterId: agent.agent_id,
    assigneeId: directAssigneeId ?? null,
    title,
    description,
    skillRequirements,
    inputData: inputData ?? null,
    inputFiles: inputFiles.length > 0 ? inputFiles : null,
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
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.taskId, id))
    .orderBy(desc(disputes.createdAt))
    .limit(1);
  const relatedAgentIds = Array.from(new Set([
    task.requesterId,
    task.assigneeId,
    ...bids.map((bid) => bid.bidderId),
  ].filter((value): value is string => Boolean(value))));

  const agentRows = relatedAgentIds.length > 0
    ? await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        trustLevel: agents.trustLevel,
        status: agents.status,
      })
      .from(agents)
      .where(inArray(agents.id, relatedAgentIds))
    : [];

  const agentMap = new Map(agentRows.map((agent) => [agent.id, agent]));

  return c.json({
    ...task,
    requester: agentMap.get(task.requesterId) ?? null,
    assignee: task.assigneeId ? (agentMap.get(task.assigneeId) ?? null) : null,
    bids: bids.map((bid) => ({
      ...bid,
      bidder: agentMap.get(bid.bidderId) ?? null,
      bidderDisplayName: agentMap.get(bid.bidderId)?.displayName ?? null,
    })),
    bidCount: bids.length,
    dispute: dispute ?? null,
  });
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

  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: updated.status },
  });

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

  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.CANCELLED },
  });

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
  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.IN_PROGRESS, assigneeId: agent.agent_id },
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
  const persisted = await persistTaskSubmission(id, parsed.data);

  const [updated] = await db.update(tasks).set({
    status: TASK_STATUS.REVIEW,
    resultArtifacts: persisted.artifacts,
    resultFiles: persisted.files,
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(tasks.id, id)).returning();

  eventBus.emit(task.requesterId, {
    type: 'task.submitted',
    data: { taskId: id, agentId: agent.agent_id, artifacts: parsed.data.artifacts },
  });
  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.REVIEW, assigneeId: agent.agent_id },
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

  // Run quality verification before releasing escrow
  let qualityScore: number | null = null;
  let qualityDetails: unknown = null;
  try {
    const artifacts = Array.isArray(task.resultArtifacts) ? task.resultArtifacts : [];
    const qualityReport = verifyTaskOutput(
      { id: task.id, inputData: task.inputData as Record<string, unknown> | null },
      artifacts,
    );
    qualityScore = qualityReport.overallScore ?? null;
    qualityDetails = qualityReport;
  } catch (err) {
    console.error('[TASKS] quality verification failed (non-blocking):', err);
  }

  // Release escrow
  let releaseTxHash: string;
  let fee: bigint;
  try {
    ({ releaseTxHash, fee } = await releaseEscrow(id));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Escrow release failed' }, 400);
  }

  const [updated] = await db.update(tasks).set({
    status: TASK_STATUS.COMPLETED,
    completedAt: new Date(),
    qualityScore,
    qualityDetails,
    updatedAt: new Date(),
  }).where(eq(tasks.id, id)).returning();

  if (task.assigneeId) {
    eventBus.emit(task.assigneeId, {
      type: 'task.completed',
      data: { taskId: id, releaseTxHash, fee: fee.toString() },
    });
  }
  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.COMPLETED, assigneeId: task.assigneeId },
  });

  // Fire-and-forget: audit log
  appendAuditLog({
    eventType: 'task.completed',
    actorId: agent.agent_id,
    targetId: id,
    targetType: 'task',
    payload: { qualityScore },
  }).catch((err) => console.error('[TASKS] audit log failed:', err));

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
  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.IN_PROGRESS, assigneeId: task.assigneeId },
  });

  return c.json(updated);
});

// GET /api/v1/tasks/:id/dispute — Get latest dispute for a task
app.get('/:id/dispute', async (c) => {
  const id = c.req.param('id');
  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.taskId, id))
    .orderBy(desc(disputes.createdAt))
    .limit(1);

  if (!dispute) {
    return c.json({ error: 'Dispute not found' }, 404);
  }

  return c.json(dispute);
});

// POST /api/v1/tasks/:id/dispute — Raise a dispute during review
app.post('/:id/dispute', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (![task.requesterId, task.assigneeId].includes(agent.agent_id)) {
    return c.json({ error: 'Only task participants can dispute this task' }, 403);
  }
  if (task.status !== TASK_STATUS.REVIEW) {
    return c.json({ error: 'Task must be in review to open a dispute' }, 400);
  }

  const body = await c.req.json();
  const parsed = TaskDisputeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const [existing] = await db
    .select()
    .from(disputes)
    .where(and(eq(disputes.taskId, id), eq(disputes.status, DISPUTE_STATUS.OPEN)))
    .limit(1);

  if (existing) {
    return c.json({ error: 'An open dispute already exists for this task' }, 409);
  }

  const againstAgentId = task.requesterId === agent.agent_id ? task.assigneeId : task.requesterId;
  const [dispute] = await db.insert(disputes).values({
    taskId: id,
    raisedByAgentId: agent.agent_id,
    againstAgentId: againstAgentId ?? null,
    reason: parsed.data.reason,
    status: DISPUTE_STATUS.OPEN,
  }).returning();

  await db.update(tasks).set({
    status: TASK_STATUS.DISPUTED,
    updatedAt: new Date(),
  }).where(eq(tasks.id, id));

  if (againstAgentId) {
    eventBus.emit(againstAgentId, {
      type: 'task.disputed',
      data: { taskId: id, disputeId: dispute.id, reason: parsed.data.reason },
    });
  }
  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.DISPUTED, assigneeId: task.assigneeId, requesterId: task.requesterId },
  });

  // Fire-and-forget: audit log
  appendAuditLog({
    eventType: 'task.disputed',
    actorId: agent.agent_id,
    targetId: id,
    targetType: 'task',
    payload: { disputeId: dispute.id, reason: parsed.data.reason },
  }).catch((err) => console.error('[TASKS] audit log failed:', err));

  return c.json(dispute, 201);
});

export default app;
