import { db } from '../db/client.js';
import { mcpServices, mcpToolCalls, mcpSubscriptions, agents } from '../db/schema.js';
import { eq, and, ilike, sql, desc } from 'drizzle-orm';
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ service: 'mcp-marketplace' });

type Database = typeof db;

// ---------------------------------------------------------------------------
// Publish a new MCP service
// ---------------------------------------------------------------------------

export async function publishService(
  agentId: string,
  data: {
    name: string;
    description: string;
    version: string;
    endpoint: string;
    tools: unknown[];
    resources?: unknown[];
    pricingModel: string;
    pricePerCall?: bigint;
    pricePerMinute?: bigint;
    subscriptionPrice?: bigint;
    category: string;
    tags?: string[];
    documentation?: string;
  },
  database: Database = db,
) {
  // Verify agent has mcpEndpoint configured
  const [agent] = await database
    .select({ id: agents.id, mcpEndpoint: agents.mcpEndpoint })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) {
    throw new Error('Agent not found');
  }
  if (!agent.mcpEndpoint) {
    throw new Error('Agent must have mcpEndpoint configured before publishing MCP services');
  }

  const [service] = await database
    .insert(mcpServices)
    .values({
      agentId,
      name: data.name,
      description: data.description,
      version: data.version,
      endpoint: data.endpoint,
      tools: data.tools,
      resources: data.resources ?? null,
      pricingModel: data.pricingModel,
      pricePerCall: data.pricePerCall ?? null,
      pricePerMinute: data.pricePerMinute ?? null,
      subscriptionPrice: data.subscriptionPrice ?? null,
      category: data.category,
      tags: data.tags ?? [],
      documentation: data.documentation ?? null,
    })
    .returning();

  logger.info('MCP service published', { agentId, serviceId: service.id, name: data.name });
  return service;
}

// ---------------------------------------------------------------------------
// Update an existing MCP service
// ---------------------------------------------------------------------------

export async function updateService(
  serviceId: string,
  agentId: string,
  updates: Record<string, unknown>,
  database: Database = db,
) {
  // Verify ownership
  const [service] = await database
    .select({ id: mcpServices.id, agentId: mcpServices.agentId })
    .from(mcpServices)
    .where(eq(mcpServices.id, serviceId))
    .limit(1);

  if (!service) {
    throw new Error('Service not found');
  }
  if (service.agentId !== agentId) {
    throw new Error('Not authorized to update this service');
  }

  const [updated] = await database
    .update(mcpServices)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(mcpServices.id, serviceId))
    .returning();

  logger.info('MCP service updated', { agentId, serviceId });
  return updated;
}

// ---------------------------------------------------------------------------
// Get a single MCP service with agent info
// ---------------------------------------------------------------------------

export async function getService(serviceId: string, database: Database = db) {
  const rows = await database
    .select({
      service: mcpServices,
      agent: {
        id: agents.id,
        displayName: agents.displayName,
        did: agents.did,
        status: agents.status,
      },
    })
    .from(mcpServices)
    .innerJoin(agents, eq(mcpServices.agentId, agents.id))
    .where(eq(mcpServices.id, serviceId))
    .limit(1);

  if (rows.length === 0) return null;

  return { ...rows[0].service, agent: rows[0].agent };
}

// ---------------------------------------------------------------------------
// List / search active public services
// ---------------------------------------------------------------------------

export async function listServices(
  filters: { q?: string; category?: string; limit: number; offset: number },
  database: Database = db,
) {
  const conditions = [
    eq(mcpServices.status, 'active'),
    eq(mcpServices.visibility, 'public'),
  ];

  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim()}%`;
    conditions.push(
      sql`(${ilike(mcpServices.name, pattern)} OR ${ilike(mcpServices.description, pattern)})`,
    );
  }

  if (filters.category) {
    conditions.push(eq(mcpServices.category, filters.category));
  }

  const whereClause = and(...conditions);

  const [{ total }] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(mcpServices)
    .where(whereClause);

  const services = await database
    .select()
    .from(mcpServices)
    .where(whereClause)
    .orderBy(desc(mcpServices.callsTotal))
    .limit(filters.limit)
    .offset(filters.offset);

  return { services, total: Number(total) };
}

// ---------------------------------------------------------------------------
// Invoke a tool call on an MCP service
// ---------------------------------------------------------------------------

export async function invokeToolCall(
  serviceId: string,
  callerId: string,
  toolName: string,
  args: Record<string, unknown>,
  database: Database = db,
) {
  // Fetch service and verify it's active
  const [service] = await database
    .select()
    .from(mcpServices)
    .where(and(eq(mcpServices.id, serviceId), eq(mcpServices.status, 'active')))
    .limit(1);

  if (!service) {
    throw new Error('Service not found or inactive');
  }

  // Check pricing: for per_call model, verify pricePerCall exists
  const costUSDC = service.pricingModel === 'per_call' ? service.pricePerCall : 0n;
  if (service.pricingModel === 'per_call' && !service.pricePerCall) {
    throw new Error('Service has per_call pricing but no price configured');
  }

  // Record the pending call
  const [callRecord] = await database
    .insert(mcpToolCalls)
    .values({
      mcpServiceId: serviceId,
      callerId,
      toolName,
      arguments: args,
      status: 'pending',
      costUSDC: costUSDC ?? 0n,
    })
    .returning();

  const startTime = Date.now();

  try {
    // Call the agent's MCP endpoint with JSON-RPC 2.0
    const response = await globalThis.fetch(service.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`MCP endpoint returned ${response.status}: ${errorText}`);
    }

    const rpcResponse = await response.json() as { result?: unknown; error?: { message: string } };

    if (rpcResponse.error) {
      throw new Error(`MCP RPC error: ${rpcResponse.error.message}`);
    }

    // Success: update call record
    await database
      .update(mcpToolCalls)
      .set({
        result: rpcResponse.result,
        completedAt: new Date(),
        durationMs,
        status: 'success',
        paid: true,
      })
      .where(eq(mcpToolCalls.id, callRecord.id));

    // Update service stats
    await updateServiceStats(serviceId, durationMs, database);

    logger.info('MCP tool call success', { serviceId, callerId, toolName, durationMs });

    return {
      id: callRecord.id,
      result: rpcResponse.result,
      durationMs,
      costUSDC: costUSDC ?? 0n,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update call record with error
    await database
      .update(mcpToolCalls)
      .set({
        completedAt: new Date(),
        durationMs,
        status: 'error',
        error: errorMessage,
      })
      .where(eq(mcpToolCalls.id, callRecord.id));

    logger.error('MCP tool call failed', { serviceId, callerId, toolName, error: errorMessage });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Subscribe to a service
// ---------------------------------------------------------------------------

export async function subscribe(
  subscriberId: string,
  serviceId: string,
  database: Database = db,
) {
  // Verify service exists and is subscription-based
  const [service] = await database
    .select()
    .from(mcpServices)
    .where(eq(mcpServices.id, serviceId))
    .limit(1);

  if (!service) {
    throw new Error('Service not found');
  }
  if (service.pricingModel !== 'subscription') {
    throw new Error('Service is not subscription-based');
  }

  const renewsAt = new Date();
  renewsAt.setDate(renewsAt.getDate() + 30);

  const [subscription] = await database
    .insert(mcpSubscriptions)
    .values({
      mcpServiceId: serviceId,
      subscriberId,
      status: 'active',
      renewsAt,
    })
    .returning();

  logger.info('MCP subscription created', { subscriberId, serviceId });
  return subscription;
}

// ---------------------------------------------------------------------------
// Cancel a subscription
// ---------------------------------------------------------------------------

export async function cancelSubscription(
  subscriberId: string,
  serviceId: string,
  database: Database = db,
) {
  const [updated] = await database
    .update(mcpSubscriptions)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
    })
    .where(
      and(
        eq(mcpSubscriptions.subscriberId, subscriberId),
        eq(mcpSubscriptions.mcpServiceId, serviceId),
        eq(mcpSubscriptions.status, 'active'),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error('Active subscription not found');
  }

  logger.info('MCP subscription cancelled', { subscriberId, serviceId });
  return updated;
}

// ---------------------------------------------------------------------------
// Get service stats (owner only)
// ---------------------------------------------------------------------------

export async function getServiceStats(
  serviceId: string,
  agentId: string,
  database: Database = db,
) {
  // Verify ownership
  const [service] = await database
    .select()
    .from(mcpServices)
    .where(eq(mcpServices.id, serviceId))
    .limit(1);

  if (!service) {
    throw new Error('Service not found');
  }
  if (service.agentId !== agentId) {
    throw new Error('Not authorized to view stats for this service');
  }

  // Get call counts by status
  const callStats = await database
    .select({
      status: mcpToolCalls.status,
      count: sql<number>`count(*)::int`,
    })
    .from(mcpToolCalls)
    .where(eq(mcpToolCalls.mcpServiceId, serviceId))
    .groupBy(mcpToolCalls.status);

  // Get total revenue from paid calls
  const [{ revenue }] = await database
    .select({
      revenue: sql<string>`COALESCE(SUM(${mcpToolCalls.costUSDC}), 0)::text`,
    })
    .from(mcpToolCalls)
    .where(
      and(
        eq(mcpToolCalls.mcpServiceId, serviceId),
        eq(mcpToolCalls.paid, true),
      ),
    );

  // Get subscriber count
  const [{ subscriberCount }] = await database
    .select({
      subscriberCount: sql<number>`count(*)::int`,
    })
    .from(mcpSubscriptions)
    .where(
      and(
        eq(mcpSubscriptions.mcpServiceId, serviceId),
        eq(mcpSubscriptions.status, 'active'),
      ),
    );

  return {
    serviceId,
    callsTotal: Number(service.callsTotal),
    callsMonthly: Number(service.callsMonthly),
    avgResponseTimeMs: service.avgResponseTimeMs,
    revenueTotal: revenue,
    callsByStatus: Object.fromEntries(callStats.map((s) => [s.status, s.count])),
    activeSubscribers: subscriberCount,
  };
}

// ---------------------------------------------------------------------------
// Update service stats (internal helper)
// ---------------------------------------------------------------------------

export async function updateServiceStats(
  serviceId: string,
  durationMs: number,
  database: Database = db,
) {
  await database
    .update(mcpServices)
    .set({
      callsTotal: sql`${mcpServices.callsTotal} + 1`,
      callsMonthly: sql`${mcpServices.callsMonthly} + 1`,
      avgResponseTimeMs: sql`CASE
        WHEN ${mcpServices.avgResponseTimeMs} IS NULL THEN ${durationMs}
        ELSE (${mcpServices.avgResponseTimeMs} * ${mcpServices.callsTotal} + ${durationMs}) / (${mcpServices.callsTotal} + 1)
      END`,
      updatedAt: new Date(),
    })
    .where(eq(mcpServices.id, serviceId));
}
