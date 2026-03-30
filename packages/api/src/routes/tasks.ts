import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/client.js';
import { tasks, taskBids, agents, disputes, taskInvitations } from '../db/schema.js';
import { eq, and, ne, inArray, sql, count, gte, lte, ilike, or, desc } from 'drizzle-orm';
import { authMiddleware, optionalAuthMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import {
  TaskCreateSchema, TaskUpdateSchema, TaskSubmitSchema, TaskListQuerySchema, TaskDisputeSchema,
  InviteAgentsSchema, InvitationListQuerySchema,
  TASK_STATUS, TASK_VISIBILITY, MATCHING_MODE, INVITATION_STATUS, AGENT_STATUS,
  DISPUTE_STATUS,
} from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import { releaseEscrow, refundEscrow } from '../services/escrow.js';
import { verifyTaskOutput } from '../services/quality.js';
import { safeAppendAuditLog } from '../services/audit.js';
import { embed } from '../services/embeddings.js';
import { persistTaskSubmission } from '../services/storage.js';
import { fetchOrderedRowsByIds, searchTasksIndex } from '../services/search.js';
import { createTaskWithOptionalFunding } from '../services/task-creation.js';
import { findSkillMatchedAgents, createSystemMatchInvitations } from '../services/invitation-matching.js';

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
      visibility: TASK_VISIBILITY.PUBLIC,
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
  conditions.push(eq(tasks.visibility, TASK_VISIBILITY.PUBLIC));
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
      const parameterizedSkills = sql`ARRAY[${sql.join(skillList.map(s => sql`${s}`), sql`, `)}]::text[]`;
      conditions.push(sql`
        EXISTS (
          SELECT 1
          FROM unnest(${tasks.skillRequirements}) AS skill
          WHERE LOWER(skill) = ANY(${parameterizedSkills})
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
  const creation = await createTaskWithOptionalFunding(c, agent.agent_id, parsed.data, { db });
  if (creation.response) {
    return creation.response;
  }

  const task = creation.task as {
    id: string;
    title: string;
    skillRequirements: string[];
    budgetMax: bigint;
    finalPrice: bigint | null;
    matchingMode: string;
    visibility: string;
    revealIdentity: boolean;
  };
  const directAssigneeId = parsed.data.directAssigneeId ?? null;
  const isPrivate = parsed.data.visibility === TASK_VISIBILITY.PRIVATE;

  if (isPrivate) {
    // Run skill matching for private tasks with open/auto matching
    let allInvitedIds = creation.invitedAgentIds ?? [];
    if (
      parsed.data.skillRequirements.length > 0 &&
      (parsed.data.matchingMode === MATCHING_MODE.OPEN || parsed.data.matchingMode === MATCHING_MODE.AUTO)
    ) {
      const excludeIds = [agent.agent_id, ...allInvitedIds];
      const matchedIds = await findSkillMatchedAgents(db, parsed.data.skillRequirements, excludeIds);
      if (matchedIds.length > 0) {
        await createSystemMatchInvitations(db, task.id, matchedIds);
        allInvitedIds = [...allInvitedIds, ...matchedIds];
      }
    }

    // Emit targeted invitations instead of broadcast
    const eventData: Record<string, unknown> = {
      taskId: task.id,
      title: task.title,
      skillRequirements: parsed.data.skillRequirements,
      budgetMax: parsed.data.budgetMax,
      matchingMode: parsed.data.matchingMode,
    };
    if (task.revealIdentity) {
      eventData.requesterId = agent.agent_id;
    }
    for (const invitedId of allInvitedIds) {
      eventBus.emit(invitedId, { type: 'task.invited', data: eventData });
    }
  } else {
    // Broadcast to all connected agents for public tasks
    eventBus.broadcast({
      type: 'task.created',
      data: {
        taskId: task.id,
        title: task.title,
        skillRequirements: parsed.data.skillRequirements,
        budgetMax: parsed.data.budgetMax,
        matchingMode: parsed.data.matchingMode,
      },
    });
  }

  if (creation.escrow) {
    eventBus.emit(agent.agent_id, {
      type: 'payment.escrowed',
      data: {
        taskId: task.id,
        amount: task.finalPrice?.toString() ?? task.budgetMax.toString(),
        txHash: (creation.escrow as { escrowTxHash: string | null }).escrowTxHash,
      },
    });
  }

  if (directAssigneeId) {
    eventBus.emit(directAssigneeId, {
      type: 'task.assigned',
      data: {
        taskId: task.id,
        price: task.finalPrice?.toString() ?? task.budgetMax.toString(),
      },
    });
  }

  // Async embed (don't block response)
  embed(parsed.data.description).then(async (vec) => {
    await db.update(tasks).set({ descriptionEmbedding: vec }).where(eq(tasks.id, task.id));
  }).catch(console.error);

  return c.json(task, 201, creation.settlementHeaders);
});

// GET /api/v1/tasks/invitations — List agent's private task invitations
app.get('/invitations', authMiddleware, async (c) => {
  const query = InvitationListQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query', details: query.error.flatten() }, 400);
  }

  const agent = c.get('agent');
  const { status: invStatus, limit, offset } = query.data;

  const conditions = [eq(taskInvitations.agentId, agent.agent_id)];
  if (invStatus) {
    conditions.push(eq(taskInvitations.status, invStatus));
  } else {
    conditions.push(ne(taskInvitations.status, INVITATION_STATUS.DECLINED));
  }

  const whereClause = and(...conditions);

  const [{ total }] = await db
    .select({ total: count() })
    .from(taskInvitations)
    .where(whereClause);

  const rows = await db
    .select()
    .from(taskInvitations)
    .innerJoin(tasks, eq(tasks.id, taskInvitations.taskId))
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(desc(taskInvitations.createdAt));

  const invitations = rows.map((row) => {
    const task = row.tasks;
    const invitation = row.task_invitations;

    // Identity masking
    const isDisputed = task.status === TASK_STATUS.DISPUTED;
    const shouldMask = !task.revealIdentity && !isDisputed;

    return {
      invitation,
      task: {
        ...task,
        requesterId: shouldMask ? null : task.requesterId,
      },
    };
  });

  return c.json({ invitations, limit, offset, total: Number(total) });
});

// POST /api/v1/tasks/:id/invite — Invite agents to a private task
app.post('/:id/invite', authMiddleware, requireScope('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const body = await c.req.json();
  const parsed = InviteAgentsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requesterId !== agent.agent_id) return c.json({ error: 'Not task owner' }, 403);
  if (task.visibility !== TASK_VISIBILITY.PRIVATE) {
    return c.json({ error: 'Can only invite agents to private tasks' }, 400);
  }

  // Validate agents exist and are active
  const validIds = parsed.data.agentIds.filter((agentId) => agentId !== agent.agent_id);
  if (validIds.length === 0) {
    return c.json({ error: 'No valid agent IDs provided' }, 400);
  }

  const activeAgents = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(inArray(agents.id, validIds), eq(agents.status, AGENT_STATUS.ACTIVE)));

  const activeIds = activeAgents.map((a) => a.id);
  if (activeIds.length === 0) {
    return c.json({ error: 'No active agents found for the given IDs' }, 400);
  }

  // Insert invitations, skipping duplicates
  await db.insert(taskInvitations).values(
    activeIds.map((agentId) => ({ taskId: id, agentId, source: 'direct' as const })),
  ).onConflictDoNothing();

  // Emit invitation events
  const eventData: Record<string, unknown> = {
    taskId: task.id,
    title: task.title,
    skillRequirements: task.skillRequirements,
    budgetMax: task.budgetMax.toString(),
    matchingMode: task.matchingMode,
  };
  if (task.revealIdentity) {
    eventData.requesterId = agent.agent_id;
  }
  for (const invitedId of activeIds) {
    eventBus.emit(invitedId, { type: 'task.invited', data: eventData });
  }

  return c.json({ invited: activeIds.length }, 201);
});

// POST /api/v1/tasks/:id/invitations/decline — Decline a task invitation
app.post('/:id/invitations/decline', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [invitation] = await db
    .select()
    .from(taskInvitations)
    .where(
      and(
        eq(taskInvitations.taskId, id),
        eq(taskInvitations.agentId, agent.agent_id),
        ne(taskInvitations.status, INVITATION_STATUS.DECLINED),
      ),
    )
    .limit(1);

  if (!invitation) {
    return c.json({ error: 'Invitation not found' }, 404);
  }

  const [updated] = await db
    .update(taskInvitations)
    .set({ status: INVITATION_STATUS.DECLINED, updatedAt: new Date() })
    .where(eq(taskInvitations.id, invitation.id))
    .returning();

  return c.json(updated);
});

// GET /api/v1/tasks/:id — Task detail
app.get('/:id', optionalAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  // Private task access control
  if (task.visibility === TASK_VISIBILITY.PRIVATE) {
    const agentPayload = c.get('agent');
    if (!agentPayload) {
      return c.json({ error: 'Task not found' }, 404);
    }
    const isOwner = task.requesterId === agentPayload.agent_id;
    if (!isOwner) {
      const [invitation] = await db
        .select({ id: taskInvitations.id })
        .from(taskInvitations)
        .where(
          and(
            eq(taskInvitations.taskId, id),
            eq(taskInvitations.agentId, agentPayload.agent_id),
            ne(taskInvitations.status, INVITATION_STATUS.DECLINED),
          ),
        )
        .limit(1);
      const isAssignee = task.assigneeId === agentPayload.agent_id;
      if (!invitation && !isAssignee) {
        return c.json({ error: 'Task not found' }, 404);
      }
    }
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

  // Identity masking for private tasks
  const agentPayload = c.get('agent');
  const isOwner = agentPayload?.agent_id === task.requesterId;
  const isDisputed = task.status === TASK_STATUS.DISPUTED;
  const shouldMaskIdentity = task.visibility === TASK_VISIBILITY.PRIVATE
    && !task.revealIdentity
    && !isOwner
    && !isDisputed;

  return c.json({
    ...task,
    requesterId: shouldMaskIdentity ? null : task.requesterId,
    requester: shouldMaskIdentity ? null : (agentMap.get(task.requesterId) ?? null),
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

  const body = await c.req.json();
  const parsed = TaskUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new HTTPException(404, { message: 'Task not found' });
    if (task.requesterId !== agent.agent_id) throw new HTTPException(403, { message: 'Not task owner' });
    if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
      throw new HTTPException(400, { message: 'Cannot update task in current status' });
    }

    const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.deadline) {
      updateData.deadline = new Date(parsed.data.deadline);
    }

    const [result] = await tx
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, id))
      .returning();

    return result;
  });

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

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new HTTPException(404, { message: 'Task not found' });
    if (task.requesterId !== agent.agent_id) throw new HTTPException(403, { message: 'Not task owner' });
    if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
      throw new HTTPException(400, { message: 'Cannot cancel task in current status' });
    }

    await tx.update(tasks).set({ status: TASK_STATUS.CANCELLED, updatedAt: new Date() }).where(eq(tasks.id, id));
  });

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

  const { updated, requesterId } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new HTTPException(404, { message: 'Task not found' });
    if (task.assigneeId !== agent.agent_id) throw new HTTPException(403, { message: 'Not assigned to this task' });
    if (task.status !== TASK_STATUS.ASSIGNED) throw new HTTPException(400, { message: 'Task not in assigned status' });

    const [result] = await tx.update(tasks).set({
      status: TASK_STATUS.IN_PROGRESS,
      startedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(tasks.id, id)).returning();

    return { updated: result, requesterId: task.requesterId };
  });

  eventBus.emit(requesterId, {
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

  const body = await c.req.json();
  const parsed = TaskSubmitSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const [currentTask] = await db.select({
    assigneeId: tasks.assigneeId,
    status: tasks.status,
  }).from(tasks).where(eq(tasks.id, id)).limit(1);

  if (!currentTask) {
    return c.json({ error: 'Task not found' }, 404);
  }
  if (currentTask.assigneeId !== agent.agent_id) {
    return c.json({ error: 'Not assigned to this task' }, 403);
  }
  if (currentTask.status !== TASK_STATUS.IN_PROGRESS) {
    return c.json({ error: 'Task not in progress' }, 400);
  }

  let persisted;
  try {
    persisted = await persistTaskSubmission(id, parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to persist task submission';
    return c.json({ error: message }, 400);
  }

  const { updated, requesterId } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new HTTPException(404, { message: 'Task not found' });
    if (task.assigneeId !== agent.agent_id) throw new HTTPException(403, { message: 'Not assigned to this task' });
    if (task.status !== TASK_STATUS.IN_PROGRESS) throw new HTTPException(400, { message: 'Task not in progress' });

    const [result] = await tx.update(tasks).set({
      status: TASK_STATUS.REVIEW,
      resultArtifacts: persisted.artifacts,
      resultFiles: persisted.files,
      submittedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(tasks.id, id)).returning();

    return { updated: result, requesterId: task.requesterId };
  });

  eventBus.emit(requesterId, {
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

  // Lock task row and validate status within a transaction to prevent double-release
  const { task, qualityScore, qualityDetails } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [t] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!t) throw new HTTPException(404, { message: 'Task not found' });
    if (t.requesterId !== agent.agent_id) throw new HTTPException(403, { message: 'Not task owner' });
    if (t.status !== TASK_STATUS.REVIEW) throw new HTTPException(400, { message: 'Task not in review status' });

    // Mark as completing inside the lock to prevent concurrent approvals
    await tx.update(tasks).set({
      status: TASK_STATUS.COMPLETED,
      updatedAt: new Date(),
    }).where(eq(tasks.id, id));

    // Quality verification (non-blocking failure)
    let qs: number | null = null;
    let qd: unknown = null;
    try {
      const artifacts = Array.isArray(t.resultArtifacts) ? t.resultArtifacts : [];
      const qualityReport = verifyTaskOutput(
        { id: t.id, inputData: t.inputData as Record<string, unknown> | null },
        artifacts,
      );
      qs = qualityReport.overallScore ?? null;
      qd = qualityReport;
    } catch (err) {
      console.error('[TASKS] quality verification failed (non-blocking):', err);
    }

    return { task: t, qualityScore: qs, qualityDetails: qd };
  });

  // Release escrow (has its own row lock on escrow_transactions)
  let releaseTxHash: string;
  let fee: bigint;
  try {
    ({ releaseTxHash, fee } = await releaseEscrow(id));
  } catch (err) {
    // Rollback task status on escrow failure
    await db.update(tasks).set({ status: TASK_STATUS.REVIEW, updatedAt: new Date() }).where(eq(tasks.id, id));
    return c.json({ error: err instanceof Error ? err.message : 'Escrow release failed' }, 400);
  }

  const [updated] = await db.update(tasks).set({
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

  safeAppendAuditLog({
    eventType: 'task.completed',
    actorId: agent.agent_id,
    targetId: id,
    targetType: 'task',
    payload: { qualityScore },
  });

  return c.json({ ...updated, releaseTxHash });
});

// POST /api/v1/tasks/:id/reject — Reject submission
app.post('/:id/reject', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const body = await c.req.json().catch(() => ({}));
  const reason = (body as { reason?: string }).reason ?? 'No reason provided';

  const { updated, assigneeId } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new HTTPException(404, { message: 'Task not found' });
    if (task.requesterId !== agent.agent_id) throw new HTTPException(403, { message: 'Not task owner' });
    if (task.status !== TASK_STATUS.REVIEW) throw new HTTPException(400, { message: 'Task not in review status' });

    const [result] = await tx.update(tasks).set({
      status: TASK_STATUS.IN_PROGRESS,
      resultArtifacts: null,
      resultFiles: null,
      submittedAt: null,
      updatedAt: new Date(),
    }).where(eq(tasks.id, id)).returning();

    return { updated: result, assigneeId: task.assigneeId };
  });

  if (assigneeId) {
    eventBus.emit(assigneeId, {
      type: 'task.rejected',
      data: { taskId: id, reason },
    });
  }
  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.IN_PROGRESS, assigneeId },
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

  const body = await c.req.json();
  const parsed = TaskDisputeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const { dispute, againstAgentId, assigneeId, requesterId } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new HTTPException(404, { message: 'Task not found' });
    if (![task.requesterId, task.assigneeId].includes(agent.agent_id)) {
      throw new HTTPException(403, { message: 'Only task participants can dispute this task' });
    }
    if (task.status !== TASK_STATUS.REVIEW) {
      throw new HTTPException(400, { message: 'Task must be in review to open a dispute' });
    }

    const [existing] = await tx
      .select()
      .from(disputes)
      .where(and(eq(disputes.taskId, id), eq(disputes.status, DISPUTE_STATUS.OPEN)))
      .limit(1);

    if (existing) {
      throw new HTTPException(409, { message: 'An open dispute already exists for this task' });
    }

    const against = task.requesterId === agent.agent_id ? task.assigneeId : task.requesterId;
    const [d] = await tx.insert(disputes).values({
      taskId: id,
      raisedByAgentId: agent.agent_id,
      againstAgentId: against ?? null,
      reason: parsed.data.reason,
      status: DISPUTE_STATUS.OPEN,
    }).returning();

    await tx.update(tasks).set({
      status: TASK_STATUS.DISPUTED,
      updatedAt: new Date(),
    }).where(eq(tasks.id, id));

    return { dispute: d, againstAgentId: against, assigneeId: task.assigneeId, requesterId: task.requesterId };
  });

  if (againstAgentId) {
    eventBus.emit(againstAgentId, {
      type: 'task.disputed',
      data: { taskId: id, disputeId: dispute.id, reason: parsed.data.reason },
    });
  }
  eventBus.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.DISPUTED, assigneeId, requesterId },
  });

  safeAppendAuditLog({
    eventType: 'task.disputed',
    actorId: agent.agent_id,
    targetId: id,
    targetType: 'task',
    payload: { disputeId: dispute.id, reason: parsed.data.reason },
  });

  return c.json(dispute, 201);
});

export default app;
