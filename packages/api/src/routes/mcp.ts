/**
 * MCP (Model Context Protocol) endpoint for agents.
 *
 * Agents register MCP tools/resources in their profile. MCP-aware clients
 * (Claude Code, etc.) can discover and invoke tools via this JSON-RPC endpoint.
 *
 * Tool calls are routed to the agent's task system: a task is created for the
 * tool invocation, and the result is returned when the agent completes it.
 */

import { Hono } from 'hono';
import { db } from '../db/client.js';
import { agents, agentSkills, mcpServices, mcpToolCalls, tasks } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { MATCHING_MODE, TASK_VISIBILITY } from '@swarmdock/shared';
import { createTaskWithOptionalFunding } from '../services/task-creation.js';
import { updateServiceStats } from '../services/mcp-marketplace.js';
import { eventBus } from '../lib/events.js';

const TOOL_CALL_TIMEOUT_MS = 30_000;

const app = new Hono();

interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function mcpError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function mcpResult(id: string | number, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

// POST /agents/:id/mcp — MCP JSON-RPC endpoint
app.post('/', async (c) => {
  const agentId = c.req.param('id') as string;

  const [agent] = await db
    .select({
      id: agents.id,
      displayName: agents.displayName,
      mcpCapabilities: agents.mcpCapabilities,
      status: agents.status,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent || agent.status !== 'active') {
    return c.json(mcpError(null, -32001, 'Agent not found or inactive'), 404);
  }

  const body = await c.req.json() as MCPRequest;
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.id == null) {
    return c.json(mcpError(body?.id ?? null, -32600, 'Invalid JSON-RPC request: must include jsonrpc "2.0", a string method, and an id'));
  }

  const capabilities = (agent.mcpCapabilities ?? {}) as {
    tools?: Array<{ name: string; description: string; inputSchema?: unknown }>;
    resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  };

  switch (body.method) {
    case 'initialize': {
      return c.json(mcpResult(body.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: agent.displayName, version: '1.0.0' },
        capabilities: {
          tools: capabilities.tools?.length ? {} : undefined,
          resources: capabilities.resources?.length ? {} : undefined,
        },
      }));
    }

    case 'tools/list': {
      const tools = capabilities.tools ?? [];
      return c.json(mcpResult(body.id, { tools }));
    }

    case 'tools/call': {
      const toolName = (body.params as { name?: string })?.name;
      const toolArgs = (body.params as { arguments?: Record<string, unknown> })?.arguments ?? {};

      const tool = capabilities.tools?.find((t) => t.name === toolName);
      if (!tool) {
        return c.json(mcpError(body.id, -32602, `Tool not found: ${toolName}`));
      }

      // Look up agent's registered MCP service for pricing
      const [service] = await db
        .select()
        .from(mcpServices)
        .where(and(eq(mcpServices.agentId, agentId), eq(mcpServices.status, 'active')))
        .limit(1);

      if (!service) {
        return c.json(mcpError(body.id, -32002, 'Agent has no active MCP service registered'));
      }

      const costUSDC = service.pricePerCall ?? 0n;
      const budgetStr = costUSDC > 0n ? costUSDC.toString() : '1000000'; // default $1 if no price

      // Record the pending tool call
      const startTime = Date.now();
      const [callRecord] = await db
        .insert(mcpToolCalls)
        .values({
          mcpServiceId: service.id,
          callerId: agentId, // MCP endpoint is unauthenticated; caller is the agent itself
          toolName: toolName!,
          arguments: toolArgs,
          status: 'pending',
          costUSDC,
        })
        .returning();

      try {
        // Create a task for the tool invocation via direct assignment
        const creation = await createTaskWithOptionalFunding(
          c,
          agentId, // requester (platform creates on behalf of MCP client)
          {
            title: `MCP: ${toolName}`,
            description: `MCP tool call: ${toolName}\n\nArguments:\n${JSON.stringify(toolArgs, null, 2)}`,
            skillRequirements: [toolName!],
            inputData: toolArgs,
            matchingMode: MATCHING_MODE.DIRECT,
            budgetMax: budgetStr,
            directAssigneeId: agentId,
            visibility: TASK_VISIBILITY.PRIVATE,
            revealIdentity: true,
            inputFiles: [],
            invitedAgentIds: [],
          },
          { db },
        );

        if (creation.response) {
          // Payment gateway redirect — cannot complete synchronously
          await db
            .update(mcpToolCalls)
            .set({ status: 'error', error: 'Payment required for task escrow', completedAt: new Date(), durationMs: Date.now() - startTime })
            .where(eq(mcpToolCalls.id, callRecord.id));
          return c.json(mcpError(body.id, -32003, 'Payment required to fund task escrow'));
        }

        const taskId = (creation.task as { id: string }).id;

        // Wait up to 30s for the agent to submit task results
        const result = await Promise.race([
          new Promise<{ taskId: string; artifacts: unknown }>((resolve) => {
            const unsubscribe = eventBus.subscribe(agentId, (event) => {
              if (event.type === 'task.submitted' && event.data.taskId === taskId) {
                unsubscribe();
                resolve({ taskId, artifacts: event.data.artifacts });
              }
            });
          }),
          new Promise<null>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), TOOL_CALL_TIMEOUT_MS);
          }),
        ]).catch((err: Error) => {
          if (err.message === 'timeout') return null;
          throw err;
        });

        const durationMs = Date.now() - startTime;

        if (result) {
          // Task completed within timeout — fetch result artifacts
          const [completedTask] = await db
            .select({ resultArtifacts: tasks.resultArtifacts })
            .from(tasks)
            .where(eq(tasks.id, taskId))
            .limit(1);

          const artifacts = Array.isArray(completedTask?.resultArtifacts)
            ? completedTask.resultArtifacts
            : [];

          // Build MCP content from artifacts
          const content = artifacts.length > 0
            ? artifacts.map((a: { type?: string; content?: unknown }) => ({
                type: 'text' as const,
                text: typeof a.content === 'string' ? a.content : JSON.stringify(a.content),
              }))
            : [{ type: 'text' as const, text: JSON.stringify(result.artifacts) }];

          // Update call record with success
          await db
            .update(mcpToolCalls)
            .set({
              result: { content },
              completedAt: new Date(),
              durationMs,
              status: 'success',
              paid: true,
            })
            .where(eq(mcpToolCalls.id, callRecord.id));

          await updateServiceStats(service.id, durationMs);

          return c.json(mcpResult(body.id, { content }));
        }

        // Timeout — return task ID so client can poll
        await db
          .update(mcpToolCalls)
          .set({ status: 'pending', durationMs })
          .where(eq(mcpToolCalls.id, callRecord.id));

        return c.json(mcpResult(body.id, {
          content: [{
            type: 'text',
            text: `Task created but not yet completed. Poll task ${taskId} for results.`,
          }],
          isComplete: false,
          taskId,
        }));
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Update call record with error
        await db
          .update(mcpToolCalls)
          .set({ status: 'error', error: errorMessage, completedAt: new Date(), durationMs })
          .where(eq(mcpToolCalls.id, callRecord.id));

        return c.json(mcpError(body.id, -32603, `Tool execution failed: ${errorMessage}`));
      }
    }

    case 'resources/list': {
      const resources = capabilities.resources ?? [];
      return c.json(mcpResult(body.id, { resources }));
    }

    case 'resources/read': {
      const uri = (body.params as { uri?: string })?.uri;
      const resource = capabilities.resources?.find((r) => r.uri === uri);
      if (!resource) {
        return c.json(mcpError(body.id, -32602, `Resource not found: ${uri}`));
      }

      // Serve agent portfolio as a built-in resource
      if (uri === 'data://agent/portfolio') {
        const skills = await db.select().from(agentSkills).where(eq(agentSkills.agentId, agentId as string));
        return c.json(mcpResult(body.id, {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ agent: agent.displayName, skills }, null, 2),
          }],
        }));
      }

      return c.json(mcpResult(body.id, {
        contents: [{ uri, mimeType: resource.mimeType ?? 'text/plain', text: '' }],
      }));
    }

    default:
      return c.json(mcpError(body.id, -32601, `Method not found: ${body.method}`));
  }
});

export default app;
