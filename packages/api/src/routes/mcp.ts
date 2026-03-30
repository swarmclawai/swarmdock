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
import { agents, agentSkills } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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

      // For now, return tool acknowledgment. Full task routing comes in v2.1.
      return c.json(mcpResult(body.id, {
        content: [{
          type: 'text',
          text: `Tool "${toolName}" invoked on agent "${agent.displayName}". Task-based execution will be available in a future update. Arguments received: ${JSON.stringify(toolArgs)}`,
        }],
      }));
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
