import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { agents, agentSkills, taskBids, tasks } from '../db/schema.js';
import { BidCreateSchema, TaskCreateSchema, TaskListQuerySchema, TASK_STATUS } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import { getAgentPortfolio } from '../services/portfolio.js';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

function success(id: JsonRpcId, result: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function failure(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

const app = new Hono<AuthContext>();

app.post('/', authMiddleware, async (c) => {
  const targetAgentId = c.req.param('id');
  const caller = c.get('agent');
  const body = await c.req.json().catch(() => ({}));
  const request = body as JsonRpcRequest;

  if (!targetAgentId) {
    return c.json(failure(request.id ?? null, -32600, 'Target agent id is required'), 400);
  }

  if (request.jsonrpc !== '2.0' || !request.method) {
    return c.json(failure(request.id ?? null, -32600, 'Invalid JSON-RPC request'), 400);
  }

  const [targetAgent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, targetAgentId))
    .limit(1);

  if (!targetAgent || targetAgent.status !== 'active') {
    return c.json(failure(request.id ?? null, -32004, 'Target agent not found'), 404);
  }

  try {
    switch (request.method) {
      case 'skills/list': {
        const skills = await db.select().from(agentSkills).where(eq(agentSkills.agentId, targetAgentId));
        return c.json(success(request.id ?? null, {
          agent: {
            id: targetAgent.id,
            did: targetAgent.did,
            displayName: targetAgent.displayName,
          },
          skills,
        }));
      }

      case 'portfolio/list': {
        return c.json(success(request.id ?? null, await getAgentPortfolio(targetAgentId)));
      }

      case 'tasks/list': {
        const parsed = TaskListQuerySchema.partial().safeParse(request.params ?? {});
        if (!parsed.success) {
          return c.json(failure(request.id ?? null, -32602, 'Invalid task list params', parsed.error.flatten()), 400);
        }

        const query = parsed.data;
        const rows = await db
          .select()
          .from(tasks)
          .where(and(
            eq(tasks.requesterId, targetAgentId),
            query.status ? eq(tasks.status, query.status) : undefined,
          ))
          .limit(query.limit ?? 20)
          .offset(query.offset ?? 0);

        return c.json(success(request.id ?? null, { tasks: rows }));
      }

      case 'tasks/get': {
        const taskId = String(request.params?.taskId ?? '');
        if (!taskId) {
          return c.json(failure(request.id ?? null, -32602, 'taskId is required'), 400);
        }

        const [task] = await db
          .select()
          .from(tasks)
          .where(and(
            eq(tasks.id, taskId),
            eq(tasks.requesterId, targetAgentId),
          ))
          .limit(1);

        if (!task) {
          return c.json(failure(request.id ?? null, -32004, 'Task not found'), 404);
        }

        return c.json(success(request.id ?? null, task));
      }

      case 'tasks/create': {
        if (caller.agent_id !== targetAgentId) {
          return c.json(failure(request.id ?? null, -32003, 'Can only create tasks for your own agent'), 403);
        }

        const parsed = TaskCreateSchema.safeParse(request.params ?? {});
        if (!parsed.success) {
          return c.json(failure(request.id ?? null, -32602, 'Invalid task payload', parsed.error.flatten()), 400);
        }

        const [task] = await db.insert(tasks).values({
          requesterId: caller.agent_id,
          assigneeId: parsed.data.directAssigneeId ?? null,
          title: parsed.data.title,
          description: parsed.data.description,
          skillRequirements: parsed.data.skillRequirements,
          inputData: parsed.data.inputData ?? null,
          matchingMode: parsed.data.matchingMode,
          budgetMin: parsed.data.budgetMin ? BigInt(parsed.data.budgetMin) : null,
          budgetMax: BigInt(parsed.data.budgetMax),
          deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
          status: parsed.data.directAssigneeId ? TASK_STATUS.ASSIGNED : TASK_STATUS.OPEN,
        }).returning();

        eventBus.broadcast({
          type: 'task.created',
          data: {
            taskId: task.id,
            title: task.title,
            skillRequirements: task.skillRequirements,
            budgetMax: task.budgetMax.toString(),
            matchingMode: task.matchingMode,
          },
        });

        return c.json(success(request.id ?? null, task));
      }

      case 'tasks/bid': {
        const taskId = String(request.params?.taskId ?? '');
        const parsed = BidCreateSchema.safeParse(request.params?.bid ?? {});

        if (!taskId || !parsed.success) {
          return c.json(
            failure(request.id ?? null, -32602, 'Invalid bid payload', parsed.success ? undefined : parsed.error.flatten()),
            400,
          );
        }

        const [task] = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, taskId), eq(tasks.requesterId, targetAgentId)))
          .limit(1);

        if (!task) {
          return c.json(failure(request.id ?? null, -32004, 'Task not found'), 404);
        }

        const [existing] = await db
          .select()
          .from(taskBids)
          .where(and(eq(taskBids.taskId, taskId), eq(taskBids.bidderId, caller.agent_id)))
          .limit(1);

        if (existing) {
          return c.json(failure(request.id ?? null, -32009, 'Bid already exists'), 409);
        }

        const [bid] = await db.insert(taskBids).values({
          taskId,
          bidderId: caller.agent_id,
          proposedPrice: BigInt(parsed.data.proposedPrice),
          confidenceScore: parsed.data.confidenceScore ?? null,
          estimatedDuration: parsed.data.estimatedDuration ?? null,
          proposal: parsed.data.proposal ?? null,
          portfolioRefs: parsed.data.portfolioRefs,
        }).returning();

        if (task.status === TASK_STATUS.OPEN) {
          await db.update(tasks).set({
            status: TASK_STATUS.BIDDING,
            updatedAt: new Date(),
          }).where(eq(tasks.id, taskId));
        }

        eventBus.emit(task.requesterId, {
          type: 'task.bid_received',
          data: { taskId, bidderId: caller.agent_id, price: parsed.data.proposedPrice },
        });

        return c.json(success(request.id ?? null, bid));
      }

      case 'message/send': {
        const intent = String(request.params?.intent ?? '');
        const forwarded = {
          ...request,
          method: intent,
          params: (request.params?.payload as Record<string, unknown>) ?? {},
        };

        const response = await app.request(c.req.url, {
          method: 'POST',
          headers: {
            authorization: c.req.header('Authorization') ?? '',
            'content-type': 'application/json',
          },
          body: JSON.stringify(forwarded),
        });

        return new Response(await response.text(), {
          status: response.status,
          headers: response.headers,
        });
      }

      default:
        return c.json(failure(request.id ?? null, -32601, `Unsupported method: ${request.method}`), 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'A2A method failed';
    return c.json(failure(request.id ?? null, -32000, message), 500);
  }
});

export default app;
