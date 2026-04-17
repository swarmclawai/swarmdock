/**
 * MCP Registry routes. Public read endpoints (servers list, detail) do not
 * require auth so the directory is Google-indexable and usable by any MCP
 * client. Write endpoints (submit, update, usage, rate, archive) require an
 * active-agent AAT and the `mcp.write` scope.
 */
import { Hono } from 'hono';
import {
  McpServerSubmitSchema,
  McpServerUpdateSchema,
  McpServerSearchQuerySchema,
  McpUsageAttestationSubmitSchema,
  McpServerRatingSchema,
} from '@swarmdock/shared';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import {
  listServers,
  getServerBySlug,
  submitServer,
  updateServer,
  recordUsage,
  rateServer,
  archiveServer,
  recommendForTask,
} from '../services/mcp-registry.js';
import { Errors } from '../lib/errors.js';

const app = new Hono<AuthContext>();

// GET /api/v1/mcp/servers — public search + listing
app.get('/servers', async (c) => {
  const parsed = McpServerSearchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw Errors.validation('Invalid search query', parsed.error.flatten());
  }
  const result = await listServers(parsed.data);
  return c.json(result);
});

// GET /api/v1/mcp/servers/recommend — semantic recommendation for a task description
app.get('/servers/recommend', async (c) => {
  const description = c.req.query('description');
  if (!description || description.length < 5) {
    throw Errors.validation('description query param required (min 5 chars)');
  }
  const transport = c.req.query('transport');
  const maxPriceRaw = c.req.query('maxPriceMicroUsdc');
  const limitRaw = c.req.query('limit');

  const recommendations = await recommendForTask({
    description,
    transport: transport ?? undefined,
    maxPriceMicroUsdc: maxPriceRaw ? BigInt(maxPriceRaw) : undefined,
    limit: limitRaw ? Math.min(50, Math.max(1, parseInt(limitRaw, 10))) : undefined,
  });

  return c.json({ recommendations });
});

// GET /api/v1/mcp/servers/:slug — public detail
app.get('/servers/:slug', async (c) => {
  const slug = c.req.param('slug');
  const server = await getServerBySlug(slug);
  if (!server) throw Errors.notFound('MCP server');
  return c.json(server);
});

// POST /api/v1/mcp/servers — submit a new server (agent-authenticated)
app.post('/servers', authMiddleware, requireScope('mcp.write'), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) throw Errors.badRequest('Invalid JSON body');
  const parsed = McpServerSubmitSchema.safeParse(body);
  if (!parsed.success) throw Errors.validation('Invalid submission', parsed.error.flatten());

  const agent = c.get('agent');
  const server = await submitServer(parsed.data, agent.agent_id);
  return c.json(server, 201);
});

// PATCH /api/v1/mcp/servers/:slug — update an existing server (submitter only)
app.patch('/servers/:slug', authMiddleware, requireScope('mcp.write'), async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => null);
  if (!body) throw Errors.badRequest('Invalid JSON body');
  const parsed = McpServerUpdateSchema.safeParse(body);
  if (!parsed.success) throw Errors.validation('Invalid update', parsed.error.flatten());

  const agent = c.get('agent');
  const server = await updateServer(slug, parsed.data, agent.agent_id);
  return c.json(server);
});

// POST /api/v1/mcp/servers/:slug/usage — signed usage attestation
app.post('/servers/:slug/usage', authMiddleware, requireScope('mcp.write'), async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => null);
  if (!body) throw Errors.badRequest('Invalid JSON body');
  const parsed = McpUsageAttestationSubmitSchema.safeParse(body);
  if (!parsed.success) throw Errors.validation('Invalid attestation', parsed.error.flatten());

  const agent = c.get('agent');
  const result = await recordUsage(slug, parsed.data, agent.agent_id);
  return c.json(result, 201);
});

// POST /api/v1/mcp/servers/:slug/rate — 1-5 rating from verified user
app.post('/servers/:slug/rate', authMiddleware, requireScope('mcp.write'), async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => null);
  if (!body) throw Errors.badRequest('Invalid JSON body');
  const parsed = McpServerRatingSchema.safeParse(body);
  if (!parsed.success) throw Errors.validation('Invalid rating', parsed.error.flatten());

  const agent = c.get('agent');
  const result = await rateServer(slug, parsed.data, agent.agent_id);
  return c.json(result, 201);
});

// DELETE /api/v1/mcp/servers/:slug — archive (submitter only, soft delete)
app.delete('/servers/:slug', authMiddleware, requireScope('mcp.write'), async (c) => {
  const slug = c.req.param('slug');
  const agent = c.get('agent');
  await archiveServer(slug, agent.agent_id);
  return c.json({ success: true });
});

export default app;
