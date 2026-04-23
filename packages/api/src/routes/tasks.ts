import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db, type Database } from '../db/client.js';
import {
  tasks,
  taskBids,
  agents,
  disputes,
  taskInvitations,
  escrowTransactions,
  qualityEvaluations,
  qualityMetrics,
} from '../db/schema.js';
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
import { shouldEscalate } from '../services/tribunal.js';
import { sendEscalationNotification } from '../lib/notify.js';
import { safeAppendAuditLog } from '../services/audit.js';
import { embed } from '../services/embeddings.js';
import { persistTaskSubmission } from '../services/storage.js';
import { fetchOrderedRowsByIds, searchTasksIndex } from '../services/search.js';
import { createTaskWithOptionalFunding } from '../services/task-creation.js';
import { findSkillMatchedAgents, createSystemMatchInvitations } from '../services/invitation-matching.js';
import { canReadTask } from './task-access.js';
import { sanitizeFreeTextFields } from '../lib/sanitize.js';
import { parsePagination } from '../lib/pagination.js';

export type TaskRouteDeps = {
  db: Database;
  authMiddleware: typeof authMiddleware;
  optionalAuthMiddleware: typeof optionalAuthMiddleware;
  requireScope: typeof requireScope;
  eventBus: Pick<typeof eventBus, 'emit' | 'broadcast'>;
  releaseEscrow: typeof releaseEscrow;
  refundEscrow: typeof refundEscrow;
  verifyTaskOutput: typeof verifyTaskOutput;
  shouldEscalate: typeof shouldEscalate;
  sendEscalationNotification: typeof sendEscalationNotification;
  safeAppendAuditLog: typeof safeAppendAuditLog;
  embed: typeof embed;
  persistTaskSubmission: typeof persistTaskSubmission;
  searchTasksIndex: typeof searchTasksIndex;
  fetchOrderedRowsByIds: typeof fetchOrderedRowsByIds;
  createTaskWithOptionalFunding: typeof createTaskWithOptionalFunding;
  findSkillMatchedAgents: typeof findSkillMatchedAgents;
  createSystemMatchInvitations: typeof createSystemMatchInvitations;
  canReadTask: typeof canReadTask;
};

export function createTasksApp(overrides: Partial<TaskRouteDeps> = {}) {
  const database = overrides.db ?? db;
  const requireAuth = overrides.authMiddleware ?? authMiddleware;
  const maybeAuth = overrides.optionalAuthMiddleware ?? optionalAuthMiddleware;
  const withScope = overrides.requireScope ?? requireScope;
  const events = overrides.eventBus ?? eventBus;
  const releaseEscrowFn = overrides.releaseEscrow ?? releaseEscrow;
  const refundEscrowFn = overrides.refundEscrow ?? refundEscrow;
  const verifyOutput = overrides.verifyTaskOutput ?? verifyTaskOutput;
  const shouldEscalateFn = overrides.shouldEscalate ?? shouldEscalate;
  const notifyEscalation = overrides.sendEscalationNotification ?? sendEscalationNotification;
  const auditLog = overrides.safeAppendAuditLog ?? safeAppendAuditLog;
  const embedText = overrides.embed ?? embed;
  const persistSubmission = overrides.persistTaskSubmission ?? persistTaskSubmission;
  const searchIndex = overrides.searchTasksIndex ?? searchTasksIndex;
  const fetchByIds = overrides.fetchOrderedRowsByIds ?? fetchOrderedRowsByIds;
  const createTask = overrides.createTaskWithOptionalFunding ?? createTaskWithOptionalFunding;
  const findMatched = overrides.findSkillMatchedAgents ?? findSkillMatchedAgents;
  const createInvitations = overrides.createSystemMatchInvitations ?? createSystemMatchInvitations;
  const canRead = overrides.canReadTask ?? canReadTask;

  const app = new Hono<AuthContext>();

// GET /api/v1/tasks — List/search tasks
app.get('/', async (c) => {
  const query = TaskListQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query', details: query.error.flatten() }, 400);
  }

  const { q, status, skills, budgetMin, budgetMax, requesterId, assigneeId, limit, offset } = query.data;

  if (!budgetMin && !budgetMax) {
    const indexed = await searchIndex({
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

      const result = await fetchByIds(indexed.ids, () =>
        database
          .select()
          .from(tasks)
          .where(inArray(tasks.id, indexed.ids)),
      );

      const bidCountRows = await database.execute(sql`
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
  const [{ total }] = await database.select({ total: count() }).from(tasks).where(whereClause);
  const result = await database.select().from(tasks).where(whereClause).orderBy(desc(tasks.createdAt)).limit(limit).offset(offset);

  const taskIds = result.map((task) => task.id);
  const bidCountRows = taskIds.length > 0
    ? await database
        .select({ taskId: taskBids.taskId, bidCount: count() })
        .from(taskBids)
        .where(inArray(taskBids.taskId, taskIds))
        .groupBy(taskBids.taskId)
    : [];

  const bidCounts = new Map<string, number>(
    bidCountRows.map((row) => [row.taskId, Number(row.bidCount)]),
  );

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
app.post('/', requireAuth, withScope('tasks.write'), async (c) => {
  const body = await c.req.json();
  const parsed = TaskCreateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const agent = c.get('agent');
  const sanitizedInput = sanitizeFreeTextFields(parsed.data, ['title', 'description']);
  const creation = await createTask(c, agent.agent_id, sanitizedInput, { db: database });
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

  // Compute description embedding once. We use it both for matching (for
  // private open/auto tasks) and to persist on the task row. Errors are swallowed
  // so matching falls back to skill-overlap only and persistence is skipped.
  let descriptionEmbedding: number[] | null = null;
  try {
    descriptionEmbedding = await embedText(parsed.data.description);
  } catch (err) {
    console.error('[tasks] embedText failed:', err);
  }

  if (isPrivate) {
    // Run skill matching for private tasks with open/auto matching
    let allInvitedIds = creation.invitedAgentIds ?? [];
    if (
      parsed.data.skillRequirements.length > 0 &&
      (parsed.data.matchingMode === MATCHING_MODE.OPEN || parsed.data.matchingMode === MATCHING_MODE.AUTO)
    ) {
      const excludeIds = [agent.agent_id, ...allInvitedIds];
      const matchedIds = await findMatched(
        database,
        parsed.data.skillRequirements,
        excludeIds,
        undefined,
        descriptionEmbedding,
      );
      if (matchedIds.length > 0) {
        await createInvitations(database, task.id, matchedIds);
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
      events.emit(invitedId, { type: 'task.invited', data: eventData });
    }
  } else {
    // Broadcast to all connected agents for public tasks
    events.broadcast({
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
    events.emit(agent.agent_id, {
      type: 'payment.escrowed',
      data: {
        taskId: task.id,
        amount: task.finalPrice?.toString() ?? task.budgetMax.toString(),
        txHash: (creation.escrow as { escrowTxHash: string | null }).escrowTxHash,
      },
    });
  }

  if (directAssigneeId) {
    events.emit(directAssigneeId, {
      type: 'task.assigned',
      data: {
        taskId: task.id,
        price: task.finalPrice?.toString() ?? task.budgetMax.toString(),
      },
    });
  }

  // Persist the embedding we computed above (if any) — don't block the response
  // on a failed write.
  if (descriptionEmbedding) {
    void (async () => {
      try {
        await database.update(tasks).set({ descriptionEmbedding }).where(eq(tasks.id, task.id));
      } catch (err) {
        console.error('[tasks] persist embedding failed:', err);
      }
    })();
  }

  return c.json(task, 201, creation.settlementHeaders);
});

// GET /api/v1/tasks/invitations — List agent's private task invitations
app.get('/invitations', requireAuth, async (c) => {
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

  const [{ total }] = await database
    .select({ total: count() })
    .from(taskInvitations)
    .where(whereClause);

  const rows = await database
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
app.post('/:id/invite', requireAuth, withScope('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const body = await c.req.json();
  const parsed = InviteAgentsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [task] = await database.select().from(tasks).where(eq(tasks.id, id)).limit(1);
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

  const activeAgents = await database
    .select({ id: agents.id })
    .from(agents)
    .where(and(inArray(agents.id, validIds), eq(agents.status, AGENT_STATUS.ACTIVE)));

  const activeIds = activeAgents.map((a) => a.id);
  if (activeIds.length === 0) {
    return c.json({ error: 'No active agents found for the given IDs' }, 400);
  }

  // Insert invitations, skipping duplicates
  await database.insert(taskInvitations).values(
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
    events.emit(invitedId, { type: 'task.invited', data: eventData });
  }

  return c.json({ invited: activeIds.length }, 201);
});

// POST /api/v1/tasks/:id/invitations/decline — Decline a task invitation
app.post('/:id/invitations/decline', requireAuth, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const [invitation] = await database
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

  const [updated] = await database
    .update(taskInvitations)
    .set({ status: INVITATION_STATUS.DECLINED, updatedAt: new Date() })
    .where(eq(taskInvitations.id, invitation.id))
    .returning();

  return c.json(updated);
});

// GET /api/v1/tasks/:id — Task detail
app.get('/:id', maybeAuth, async (c) => {
  const id = c.req.param('id');
  const [task] = await database.select().from(tasks).where(eq(tasks.id, id)).limit(1);

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  // Private task access control
  if (task.visibility === TASK_VISIBILITY.PRIVATE) {
    const viewerAgentId = c.get('agent')?.agent_id ?? null;
    if (!await canRead(database, task, viewerAgentId)) {
      return c.json({ error: 'Task not found' }, 404);
    }
  }

  const { limit: bidsLimit, offset: bidsOffset } = parsePagination(
    c.req.query('bidsLimit'),
    c.req.query('bidsOffset'),
    { defaultLimit: 100, maxLimit: 100 },
  );
  const [{ total: bidTotal }] = await database
    .select({ total: count() })
    .from(taskBids)
    .where(eq(taskBids.taskId, id));
  const bids = await database
    .select()
    .from(taskBids)
    .where(eq(taskBids.taskId, id))
    .orderBy(desc(taskBids.createdAt))
    .limit(bidsLimit)
    .offset(bidsOffset);
  const [dispute] = await database
    .select()
    .from(disputes)
    .where(eq(disputes.taskId, id))
    .orderBy(desc(disputes.createdAt))
    .limit(1);
  const [escrow] = await database
    .select({
      id: escrowTransactions.id,
      status: escrowTransactions.status,
      amount: escrowTransactions.amount,
      platformFee: escrowTransactions.platformFee,
      escrowTxHash: escrowTransactions.escrowTxHash,
      releaseTxHash: escrowTransactions.releaseTxHash,
      network: escrowTransactions.network,
      createdAt: escrowTransactions.createdAt,
      updatedAt: escrowTransactions.updatedAt,
    })
    .from(escrowTransactions)
    .where(eq(escrowTransactions.taskId, id))
    .orderBy(desc(escrowTransactions.createdAt))
    .limit(1);
  const [qualityEval] = await database
    .select()
    .from(qualityEvaluations)
    .where(eq(qualityEvaluations.taskId, id))
    .orderBy(desc(qualityEvaluations.createdAt))
    .limit(1);
  const qualityMetricRows = qualityEval
    ? await database
      .select()
      .from(qualityMetrics)
      .where(eq(qualityMetrics.evaluationId, qualityEval.id))
    : [];

  const relatedAgentIds = Array.from(new Set([
    task.requesterId,
    task.assigneeId,
    ...bids.map((bid) => bid.bidderId),
  ].filter((value): value is string => Boolean(value))));

  const agentRows = relatedAgentIds.length > 0
    ? await database
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

  const qualityEvaluation = qualityEval
    ? {
        id: qualityEval.id,
        finalScore: qualityEval.finalScore,
        finalVerdict: qualityEval.finalVerdict,
        createdAt: qualityEval.createdAt,
        updatedAt: qualityEval.updatedAt,
        stages: {
          schema: {
            status: qualityEval.schemaValidatedAt
              ? qualityEval.schemaValidationPassed
                ? 'passed'
                : 'failed'
              : 'pending',
            errors: qualityEval.schemaValidationErrors,
            evaluatedAt: qualityEval.schemaValidatedAt,
          },
          llm: {
            status: qualityEval.llmEvaluatedAt ? 'completed' : 'pending',
            score: qualityEval.llmScore,
            reasoning: qualityEval.llmReasoning,
            confidence: qualityEval.llmConfidence,
            evaluatedAt: qualityEval.llmEvaluatedAt,
          },
          faithfulness: {
            status: qualityEval.faithfulnessEvaluatedAt ? 'completed' : 'pending',
            score: qualityEval.faithfulnessScore,
            evaluatedAt: qualityEval.faithfulnessEvaluatedAt,
          },
          peerReview: {
            status: qualityEval.peerReviewCompletedAt
              ? 'completed'
              : qualityEval.peerReviewRequested
                ? 'pending'
                : 'skipped',
            score: qualityEval.peerReviewScore,
            reviewerCount: qualityEval.peerReviewers?.length ?? 0,
            completedAt: qualityEval.peerReviewCompletedAt,
          },
        },
        metrics: qualityMetricRows.map((m) => ({
          stage: m.stage,
          metric: m.metric,
          score: m.score,
          reasoning: m.reasoning,
        })),
      }
    : null;

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
    bidCount: Number(bidTotal),
    bidsLimit,
    bidsOffset,
    dispute: dispute ?? null,
    escrow: escrow
      ? {
          ...escrow,
          amount: escrow.amount.toString(),
          platformFee: escrow.platformFee?.toString() ?? null,
        }
      : null,
    qualityEvaluation,
  });
});

// PATCH /api/v1/tasks/:id — Update task (owner only)
app.patch('/:id', requireAuth, withScope('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const body = await c.req.json();
  const parsed = TaskUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const updated = await database.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new HTTPException(404, { message: 'Task not found' });
    if (task.requesterId !== agent.agent_id) throw new HTTPException(403, { message: 'Not task owner' });
    if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
      throw new HTTPException(400, { message: 'Cannot update task in current status' });
    }

    const sanitized = sanitizeFreeTextFields(parsed.data, ['title', 'description']);
    const { title, description, deadline } = sanitized;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (deadline !== undefined) updateData.deadline = new Date(deadline);

    const [result] = await tx
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, id))
      .returning();

    return result;
  });

  events.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: updated.status },
  });

  return c.json(updated);
});

// DELETE /api/v1/tasks/:id — Cancel task
app.delete('/:id', requireAuth, withScope('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  await database.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new HTTPException(404, { message: 'Task not found' });
    if (task.requesterId !== agent.agent_id) throw new HTTPException(403, { message: 'Not task owner' });
    if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
      throw new HTTPException(400, { message: 'Cannot cancel task in current status' });
    }

    await tx.update(tasks).set({ status: TASK_STATUS.CANCELLED, updatedAt: new Date() }).where(eq(tasks.id, id));
  });

  events.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.CANCELLED },
  });

  // Refund escrow if any
  await refundEscrowFn(id);

  return c.json({ message: 'Task cancelled' });
});

// POST /api/v1/tasks/:id/start — Agent starts work
app.post('/:id/start', requireAuth, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const { updated, requesterId } = await database.transaction(async (tx) => {
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

  events.emit(requesterId, {
    type: 'task.started',
    data: { taskId: id, agentId: agent.agent_id },
  });
  events.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.IN_PROGRESS, assigneeId: agent.agent_id },
  });

  return c.json(updated);
});

// POST /api/v1/tasks/:id/submit — Submit results
app.post('/:id/submit', requireAuth, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const body = await c.req.json();
  const parsed = TaskSubmitSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  // Enforce 50MB total submission size
  const totalBytes = parsed.data.artifacts.reduce((sum, a) => {
    return sum + (typeof a.content === 'string' ? a.content.length : JSON.stringify(a.content).length);
  }, 0);
  if (totalBytes > 50_000_000) {
    return c.json({ error: 'Total submission size exceeds 50MB limit' }, 400);
  }

  const [currentTask] = await database.select({
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
    persisted = await persistSubmission(id, parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to persist task submission';
    return c.json({ error: message }, 400);
  }

  const { updated, requesterId } = await database.transaction(async (tx) => {
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

  events.emit(requesterId, {
    type: 'task.submitted',
    data: { taskId: id, agentId: agent.agent_id, artifacts: parsed.data.artifacts },
  });
  events.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.REVIEW, assigneeId: agent.agent_id },
  });

  return c.json(updated);
});

// POST /api/v1/tasks/:id/approve — Approve and release payment
app.post('/:id/approve', requireAuth, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  // Lock task row and validate status within a transaction to prevent double-release
  const { task, qualityScore, qualityDetails } = await database.transaction(async (tx) => {
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
      const qualityReport = await verifyOutput(
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
    ({ releaseTxHash, fee } = await releaseEscrowFn(id));
  } catch (err) {
    // Rollback task status on escrow failure
    await database.update(tasks).set({ status: TASK_STATUS.REVIEW, updatedAt: new Date() }).where(eq(tasks.id, id));
    return c.json({ error: err instanceof Error ? err.message : 'Escrow release failed' }, 400);
  }

  const [updated] = await database.update(tasks).set({
    completedAt: new Date(),
    qualityScore,
    qualityDetails,
    updatedAt: new Date(),
  }).where(eq(tasks.id, id)).returning();

  if (task.assigneeId) {
    events.emit(task.assigneeId, {
      type: 'task.completed',
      data: { taskId: id, releaseTxHash, fee: fee.toString() },
    });
  }
  events.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.COMPLETED, assigneeId: task.assigneeId },
  });

  auditLog({
    eventType: 'task.completed',
    actorId: agent.agent_id,
    targetId: id,
    targetType: 'task',
    payload: { qualityScore },
  });

  return c.json({ ...updated, releaseTxHash });
});

// POST /api/v1/tasks/:id/reject — Reject submission
app.post('/:id/reject', requireAuth, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const body = await c.req.json().catch(() => ({}));
  const reason = (body as { reason?: string }).reason ?? 'No reason provided';

  const { updated, assigneeId } = await database.transaction(async (tx) => {
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
    events.emit(assigneeId, {
      type: 'task.rejected',
      data: { taskId: id, reason },
    });
  }
  events.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.IN_PROGRESS, assigneeId },
  });

  return c.json(updated);
});

// GET /api/v1/tasks/:id/dispute — Get latest dispute for a task
app.get('/:id/dispute', maybeAuth, async (c) => {
  const id = c.req.param('id');
  const [task] = await database
    .select({
      id: tasks.id,
      visibility: tasks.visibility,
      requesterId: tasks.requesterId,
      assigneeId: tasks.assigneeId,
    })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const viewerAgentId = c.get('agent')?.agent_id ?? null;
  if (!await canRead(database, task, viewerAgentId)) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const [dispute] = await database
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
app.post('/:id/dispute', requireAuth, async (c) => {
  const id = c.req.param('id');
  const agent = c.get('agent');

  const body = await c.req.json();
  const parsed = TaskDisputeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const { dispute, againstAgentId, assigneeId, requesterId } = await database.transaction(async (tx) => {
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
    events.emit(againstAgentId, {
      type: 'task.disputed',
      data: { taskId: id, disputeId: dispute.id, reason: parsed.data.reason },
    });
  }
  events.broadcast({
    type: 'task.updated',
    data: { taskId: id, status: TASK_STATUS.DISPUTED, assigneeId, requesterId },
  });

  auditLog({
    eventType: 'task.disputed',
    actorId: agent.agent_id,
    targetId: id,
    targetType: 'task',
    payload: { disputeId: dispute.id, reason: parsed.data.reason },
  });

  // Check if dispute should be escalated (high-value or repeated failures)
  const [taskForEscalation] = await database.select({ budgetMax: tasks.budgetMax }).from(tasks).where(eq(tasks.id, id)).limit(1);
  if (taskForEscalation && await shouldEscalateFn(id, taskForEscalation.budgetMax)) {
    const [updatedDispute] = await database
      .update(disputes)
      .set({ status: DISPUTE_STATUS.ESCALATED, updatedAt: new Date() })
      .where(eq(disputes.id, dispute.id))
      .returning();
    notifyEscalation({
      disputeId: dispute.id,
      taskId: id,
      amount: taskForEscalation.budgetMax.toString(),
      reason: parsed.data.reason,
      raisedBy: agent.agent_id,
      against: againstAgentId ?? null,
    }).catch((err) => console.error('[ESCALATION] notification failed:', err));
    return c.json(updatedDispute ?? { ...dispute, status: DISPUTE_STATUS.ESCALATED }, 201);
  }

  return c.json(dispute, 201);
});

  return app;
}

export default createTasksApp();
