/**
 * MCP registry service. Owns the read and write paths for the public
 * directory of Model Context Protocol servers:
 *
 *  - listServers / getServerBySlug — search + detail reads
 *  - submitServer / updateServer   — agent-authenticated writes
 *  - recordUsage                   — signed attestation, feeds quality score
 *  - rateServer                    — 1-5 score gated on having used the server
 *  - upsertIngestedServer          — idempotent write path for the ingestion
 *                                    worker's upstream-registry adapters
 *
 * Quality score is a normalized blend of verified-usage volume and average
 * rating. It is recomputed whenever an attestation or rating lands.
 */
import { and, desc, eq, sql, inArray } from 'drizzle-orm';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
import { db } from '../db/client.js';
import {
  mcpServers,
  mcpServerTools,
  mcpServerInstallations,
  mcpUsageEvents,
  mcpServerRatings,
  agents,
} from '../db/schema.js';
import { embed } from './embeddings.js';
import {
  canonicalizeAttestationPayload,
  type McpServer,
  type McpServerDetail,
  type McpServerRatingInput,
  type McpServerSearchQuery,
  type McpServerSubmitInput,
  type McpServerUpdateInput,
  type McpUsageAttestationSubmit,
  MCP_ATTESTATION_MAX_BYTES,
  MCP_USAGE_OUTCOME,
  MCP_REGISTRY_SOURCE,
} from '@swarmdock/shared';
import { Errors } from '../lib/errors.js';

const ATTESTATION_MAX_SKEW_SECONDS = 300;

function rowToServer(row: typeof mcpServers.$inferSelect): McpServer {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    homepage: row.homepage,
    repoUrl: row.repoUrl,
    license: row.license,
    transport: row.transport,
    authMode: row.authMode,
    language: row.language,
    categories: row.categories,
    tags: row.tags,
    ingestedFrom: row.ingestedFrom,
    upstreamIds: (row.upstreamIds ?? {}) as Record<string, string>,
    qualityScore: row.qualityScore,
    verifiedUsageCount: row.verifiedUsageCount,
    submittedByAgentId: row.submittedByAgentId,
    paidTier: row.paidTier,
    priceMicroUsdc: row.priceMicroUsdc?.toString() ?? null,
    payoutAddress: row.payoutAddress,
    lastCrawledAt: row.lastCrawledAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listServers(
  query: McpServerSearchQuery,
): Promise<{ servers: McpServer[]; total: number }> {
  const predicates = [sql`${mcpServers.archivedAt} IS NULL`];

  if (query.transport) predicates.push(eq(mcpServers.transport, query.transport));
  if (query.authMode) predicates.push(eq(mcpServers.authMode, query.authMode));
  if (query.language) predicates.push(eq(mcpServers.language, query.language));
  if (query.paidTier !== undefined) predicates.push(eq(mcpServers.paidTier, query.paidTier));
  if (query.category) {
    predicates.push(sql`${query.category} = ANY(${mcpServers.categories})`);
  }
  if (query.minQuality !== undefined) {
    predicates.push(sql`${mcpServers.qualityScore} >= ${query.minQuality}`);
  }

  let orderExpr = sql`${mcpServers.qualityScore} DESC, ${mcpServers.verifiedUsageCount} DESC`;

  if (query.q && query.q.trim().length > 0) {
    const queryEmbedding = await embed(query.q, 'query');
    const embedLiteral = `[${queryEmbedding.join(',')}]`;
    predicates.push(sql`${mcpServers.descriptionEmbedding} IS NOT NULL`);
    orderExpr = sql`${mcpServers.descriptionEmbedding} <=> ${embedLiteral}::vector`;
  }

  const rows = await db
    .select()
    .from(mcpServers)
    .where(and(...predicates))
    .orderBy(orderExpr)
    .limit(query.limit)
    .offset(query.offset);

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(mcpServers)
    .where(and(...predicates));

  return { servers: rows.map(rowToServer), total: Number(total) };
}

export async function getServerBySlug(slug: string): Promise<McpServerDetail | null> {
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.slug, slug), sql`${mcpServers.archivedAt} IS NULL`))
    .limit(1);

  if (!server) return null;

  const [tools, installations, ratings] = await Promise.all([
    db.select().from(mcpServerTools).where(eq(mcpServerTools.serverId, server.id)),
    db.select().from(mcpServerInstallations).where(eq(mcpServerInstallations.serverId, server.id)),
    db.select({
      avgScore: sql<number>`AVG(${mcpServerRatings.score})::float`,
      count: sql<number>`COUNT(*)::int`,
    }).from(mcpServerRatings).where(eq(mcpServerRatings.serverId, server.id)),
  ]);

  return {
    ...rowToServer(server),
    tools: tools.map((t) => ({
      id: t.id,
      serverId: t.serverId,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      createdAt: t.createdAt.toISOString(),
    })),
    installations: installations.map((i) => ({
      id: i.id,
      serverId: i.serverId,
      method: i.method,
      spec: i.spec as Record<string, unknown>,
      createdAt: i.createdAt.toISOString(),
    })),
    avgRating: ratings[0]?.avgScore ? Number(ratings[0].avgScore) : null,
    ratingCount: Number(ratings[0]?.count ?? 0),
  };
}

export async function submitServer(
  input: McpServerSubmitInput,
  submittedByAgentId: string,
): Promise<McpServerDetail> {
  const existing = await db.select({ id: mcpServers.id }).from(mcpServers).where(eq(mcpServers.slug, input.slug)).limit(1);
  if (existing.length > 0) {
    throw Errors.conflict('An MCP server with that slug already exists');
  }

  const descriptionEmbedding = await embed(`${input.name}\n\n${input.description}`, 'document');

  return db.transaction(async (tx) => {
    const [server] = await tx.insert(mcpServers).values({
      slug: input.slug,
      name: input.name,
      description: input.description,
      homepage: input.homepage ?? null,
      repoUrl: input.repoUrl ?? null,
      license: input.license ?? null,
      transport: input.transport,
      authMode: input.authMode,
      language: input.language ?? null,
      categories: input.categories,
      tags: input.tags,
      ingestedFrom: [MCP_REGISTRY_SOURCE.SUBMITTED],
      upstreamIds: {},
      qualityScore: 0,
      verifiedUsageCount: 0,
      submittedByAgentId,
      paidTier: input.paidTier,
      priceMicroUsdc: input.priceMicroUsdc ? BigInt(input.priceMicroUsdc) : null,
      payoutAddress: input.payoutAddress ?? null,
      descriptionEmbedding,
    }).returning();

    if (input.installations.length > 0) {
      await tx.insert(mcpServerInstallations).values(
        input.installations.map((i) => ({
          serverId: server.id,
          method: i.method,
          spec: i.spec,
        })),
      );
    }

    if (input.tools.length > 0) {
      const toolEmbeddings = await Promise.all(
        input.tools.map((t) => embed(`${t.name}\n\n${t.description ?? ''}`, 'document')),
      );
      await tx.insert(mcpServerTools).values(
        input.tools.map((t, i) => ({
          serverId: server.id,
          name: t.name,
          description: t.description ?? null,
          inputSchema: t.inputSchema as object ?? null,
          toolEmbedding: toolEmbeddings[i],
        })),
      );
    }

    return (await getServerBySlug(input.slug))!;
  });
}

export async function updateServer(
  slug: string,
  input: McpServerUpdateInput,
  agentId: string,
): Promise<McpServerDetail> {
  const [existing] = await db.select().from(mcpServers).where(eq(mcpServers.slug, slug)).limit(1);
  if (!existing) throw Errors.notFound('MCP server');
  if (existing.submittedByAgentId !== agentId) {
    throw Errors.forbidden('Only the submitter may update this server');
  }

  const patch: Partial<typeof mcpServers.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.homepage !== undefined) patch.homepage = input.homepage ?? null;
  if (input.repoUrl !== undefined) patch.repoUrl = input.repoUrl ?? null;
  if (input.license !== undefined) patch.license = input.license ?? null;
  if (input.transport !== undefined) patch.transport = input.transport;
  if (input.authMode !== undefined) patch.authMode = input.authMode;
  if (input.language !== undefined) patch.language = input.language ?? null;
  if (input.categories !== undefined) patch.categories = input.categories;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.paidTier !== undefined) patch.paidTier = input.paidTier;
  if (input.priceMicroUsdc !== undefined) patch.priceMicroUsdc = BigInt(input.priceMicroUsdc);
  if (input.payoutAddress !== undefined) patch.payoutAddress = input.payoutAddress ?? null;
  patch.updatedAt = new Date();

  if (input.name !== undefined || input.description !== undefined) {
    const name = input.name ?? existing.name;
    const description = input.description ?? existing.description;
    patch.descriptionEmbedding = await embed(`${name}\n\n${description}`, 'document');
  }

  await db.update(mcpServers).set(patch).where(eq(mcpServers.id, existing.id));
  return (await getServerBySlug(slug))!;
}

async function recomputeQualityScore(serverId: string): Promise<void> {
  const [stats] = await db
    .select({
      successCount: sql<number>`COUNT(*) FILTER (WHERE ${mcpUsageEvents.outcome} = ${MCP_USAGE_OUTCOME.SUCCESS})::int`,
      totalCount: sql<number>`COUNT(*)::int`,
    })
    .from(mcpUsageEvents)
    .where(eq(mcpUsageEvents.serverId, serverId));

  const [ratingStats] = await db
    .select({
      avg: sql<number>`AVG(${mcpServerRatings.score})::float`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(mcpServerRatings)
    .where(eq(mcpServerRatings.serverId, serverId));

  const totalUsage = Number(stats?.totalCount ?? 0);
  const successUsage = Number(stats?.successCount ?? 0);
  const successRate = totalUsage > 0 ? successUsage / totalUsage : 0;
  const avgRating = ratingStats?.avg ? Number(ratingStats.avg) / 5 : 0;
  const ratingCount = Number(ratingStats?.count ?? 0);

  // Weighted blend: success rate (50%) + normalized rating (30%) + log-scaled
  // usage volume (20%). Volume saturates at ~log10(1000) so high-traffic
  // servers don't dominate purely on quantity.
  const volumeComponent = totalUsage > 0 ? Math.min(1, Math.log10(totalUsage + 1) / 3) : 0;
  const score = 0.5 * successRate + 0.3 * avgRating + 0.2 * volumeComponent;

  await db.update(mcpServers)
    .set({
      qualityScore: Number(score.toFixed(4)),
      verifiedUsageCount: successUsage,
      updatedAt: new Date(),
    })
    .where(eq(mcpServers.id, serverId));

  // Track rating count so callers don't have to recompute it; surfaced via detail API
  void ratingCount;
}

export async function recordUsage(
  slug: string,
  submission: McpUsageAttestationSubmit,
  agentId: string,
): Promise<{ id: string; qualityScore: number }> {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.slug, slug)).limit(1);
  if (!server) throw Errors.notFound('MCP server');

  // Agent identity — use the DB-of-record rather than trusting the AAT-bound did
  const [agent] = await db.select({ id: agents.id, did: agents.did, publicKey: agents.publicKey })
    .from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) throw Errors.notFound('Agent');
  if (submission.agentDid !== agent.did) {
    throw Errors.validation('agentDid does not match authenticated agent');
  }
  if (submission.serverSlug !== slug) {
    throw Errors.validation('serverSlug does not match URL slug');
  }

  // Replay-window check
  const signedAtMs = Date.parse(submission.signedAt);
  if (Math.abs(Date.now() - signedAtMs) > ATTESTATION_MAX_SKEW_SECONDS * 1000) {
    throw Errors.validation('Signed timestamp outside allowed window');
  }

  // Canonicalize and verify signature
  const payload = {
    serverSlug: submission.serverSlug,
    outcome: submission.outcome,
    latencyMs: submission.latencyMs,
    errorCode: submission.errorCode,
    toolName: submission.toolName,
    taskId: submission.taskId,
    agentDid: submission.agentDid,
    signedAt: submission.signedAt,
  };
  const canonical = canonicalizeAttestationPayload(payload);
  if (Buffer.byteLength(canonical, 'utf8') > MCP_ATTESTATION_MAX_BYTES) {
    throw Errors.validation('Attestation payload exceeds maximum size');
  }

  const publicKeyBytes = tweetnaclUtil.decodeBase64(agent.publicKey);
  const signatureBytes = tweetnaclUtil.decodeBase64(submission.signature);
  const messageBytes = tweetnaclUtil.decodeUTF8(canonical);
  const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  if (!valid) throw Errors.validation('Attestation signature did not verify');

  const [inserted] = await db.insert(mcpUsageEvents).values({
    serverId: server.id,
    agentId: agent.id,
    agentDid: agent.did,
    taskId: submission.taskId ?? null,
    outcome: submission.outcome,
    latencyMs: submission.latencyMs ?? null,
    errorCode: submission.errorCode ?? null,
    toolName: submission.toolName ?? null,
    signature: submission.signature,
    signedAt: new Date(signedAtMs),
  }).returning({ id: mcpUsageEvents.id });

  await recomputeQualityScore(server.id);

  const [updated] = await db.select({ qs: mcpServers.qualityScore })
    .from(mcpServers).where(eq(mcpServers.id, server.id)).limit(1);

  return { id: inserted.id, qualityScore: Number(updated.qs) };
}

export async function rateServer(
  slug: string,
  input: McpServerRatingInput,
  agentId: string,
): Promise<{ id: string }> {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.slug, slug)).limit(1);
  if (!server) throw Errors.notFound('MCP server');

  // Must have at least one recorded usage event to rate the server
  const [hasUsage] = await db.select({ id: mcpUsageEvents.id })
    .from(mcpUsageEvents)
    .where(and(eq(mcpUsageEvents.serverId, server.id), eq(mcpUsageEvents.agentId, agentId)))
    .limit(1);
  if (!hasUsage) {
    throw Errors.forbidden('Must record a usage attestation before rating');
  }

  const [rating] = await db.insert(mcpServerRatings).values({
    serverId: server.id,
    agentId,
    score: input.score,
    comment: input.comment ?? null,
    usageEventId: input.usageEventId ?? null,
  }).onConflictDoUpdate({
    target: [mcpServerRatings.agentId, mcpServerRatings.serverId],
    set: {
      score: input.score,
      comment: input.comment ?? null,
      usageEventId: input.usageEventId ?? null,
      updatedAt: new Date(),
    },
  }).returning({ id: mcpServerRatings.id });

  await recomputeQualityScore(server.id);
  return { id: rating.id };
}

/**
 * Idempotent upsert used by the ingestion worker. Keyed by slug. Preserves
 * existing quality signal (usage, ratings) and only updates metadata + source
 * list + timestamps when an upstream adapter re-crawls.
 */
export async function upsertIngestedServer(
  source: string,
  upstream: {
    slug: string;
    name: string;
    description: string;
    homepage?: string;
    repoUrl?: string;
    license?: string;
    transport: string;
    authMode: string;
    language?: string;
    categories?: string[];
    tags?: string[];
    upstreamId: string;
    installations?: Array<{ method: string; spec: Record<string, unknown> }>;
    tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  },
): Promise<{ serverId: string; created: boolean }> {
  const existing = await db.select().from(mcpServers).where(eq(mcpServers.slug, upstream.slug)).limit(1);
  const descriptionEmbedding = await embed(`${upstream.name}\n\n${upstream.description}`, 'document');

  if (existing.length === 0) {
    const [server] = await db.insert(mcpServers).values({
      slug: upstream.slug,
      name: upstream.name,
      description: upstream.description,
      homepage: upstream.homepage ?? null,
      repoUrl: upstream.repoUrl ?? null,
      license: upstream.license ?? null,
      transport: upstream.transport,
      authMode: upstream.authMode,
      language: upstream.language ?? null,
      categories: upstream.categories ?? [],
      tags: upstream.tags ?? [],
      ingestedFrom: [source],
      upstreamIds: { [source]: upstream.upstreamId },
      qualityScore: 0,
      verifiedUsageCount: 0,
      descriptionEmbedding,
      lastCrawledAt: new Date(),
    }).returning({ id: mcpServers.id });

    if (upstream.installations?.length) {
      await db.insert(mcpServerInstallations).values(
        upstream.installations.map((i) => ({
          serverId: server.id,
          method: i.method,
          spec: i.spec,
        })),
      );
    }

    if (upstream.tools?.length) {
      const toolEmbeddings = await Promise.all(
        upstream.tools.map((t) => embed(`${t.name}\n\n${t.description ?? ''}`, 'document')),
      );
      await db.insert(mcpServerTools).values(
        upstream.tools.map((t, i) => ({
          serverId: server.id,
          name: t.name,
          description: t.description ?? null,
          inputSchema: (t.inputSchema as object) ?? null,
          toolEmbedding: toolEmbeddings[i],
        })),
      );
    }
    return { serverId: server.id, created: true };
  }

  const row = existing[0];
  const mergedSources = Array.from(new Set([...row.ingestedFrom, source]));
  const mergedUpstreamIds = { ...(row.upstreamIds as Record<string, string>), [source]: upstream.upstreamId };

  await db.update(mcpServers).set({
    name: upstream.name,
    description: upstream.description,
    homepage: upstream.homepage ?? row.homepage,
    repoUrl: upstream.repoUrl ?? row.repoUrl,
    license: upstream.license ?? row.license,
    transport: upstream.transport,
    authMode: upstream.authMode,
    language: upstream.language ?? row.language,
    categories: upstream.categories ?? row.categories,
    tags: upstream.tags ?? row.tags,
    ingestedFrom: mergedSources,
    upstreamIds: mergedUpstreamIds,
    descriptionEmbedding,
    lastCrawledAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(mcpServers.id, row.id));

  // Replace installations and tools — upstream snapshot is authoritative for these
  if (upstream.installations?.length) {
    await db.delete(mcpServerInstallations).where(eq(mcpServerInstallations.serverId, row.id));
    await db.insert(mcpServerInstallations).values(
      upstream.installations.map((i) => ({
        serverId: row.id,
        method: i.method,
        spec: i.spec,
      })),
    );
  }

  if (upstream.tools?.length) {
    const toolEmbeddings = await Promise.all(
      upstream.tools.map((t) => embed(`${t.name}\n\n${t.description ?? ''}`, 'document')),
    );
    await db.delete(mcpServerTools).where(eq(mcpServerTools.serverId, row.id));
    await db.insert(mcpServerTools).values(
      upstream.tools.map((t, i) => ({
        serverId: row.id,
        name: t.name,
        description: t.description ?? null,
        inputSchema: (t.inputSchema as object) ?? null,
        toolEmbedding: toolEmbeddings[i],
      })),
    );
  }

  return { serverId: row.id, created: false };
}

/**
 * Semantic recommendation — used by the MCP tool `recommend_mcp_for_task`.
 * Given a free-text description of what an agent needs to do, surface the
 * top-scoring servers ranked by blended embedding similarity, quality score,
 * and price filter when supplied.
 */
export async function recommendForTask(params: {
  description: string;
  maxPriceMicroUsdc?: bigint;
  transport?: string;
  limit?: number;
}): Promise<Array<McpServer & { similarity: number }>> {
  const limit = params.limit ?? 10;
  const queryEmbedding = await embed(params.description, 'query');
  const embedLiteral = `[${queryEmbedding.join(',')}]`;

  const predicates = [
    sql`${mcpServers.archivedAt} IS NULL`,
    sql`${mcpServers.descriptionEmbedding} IS NOT NULL`,
  ];
  if (params.transport) predicates.push(eq(mcpServers.transport, params.transport));
  if (params.maxPriceMicroUsdc !== undefined) {
    predicates.push(
      sql`(${mcpServers.paidTier} = false OR ${mcpServers.priceMicroUsdc} <= ${params.maxPriceMicroUsdc})`,
    );
  }

  const rows = await db
    .select({
      row: mcpServers,
      similarity: sql<number>`1 - (${mcpServers.descriptionEmbedding} <=> ${embedLiteral}::vector)`.as('similarity'),
    })
    .from(mcpServers)
    .where(and(...predicates))
    .orderBy(sql`(${mcpServers.descriptionEmbedding} <=> ${embedLiteral}::vector) - (${mcpServers.qualityScore} * 0.2)`)
    .limit(limit);

  return rows.map((r) => ({ ...rowToServer(r.row), similarity: Number(r.similarity) }));
}

export async function listServersByIds(ids: string[]): Promise<McpServer[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(mcpServers).where(inArray(mcpServers.id, ids));
  return rows.map(rowToServer);
}

export async function archiveServer(slug: string, agentId: string): Promise<void> {
  const [existing] = await db.select().from(mcpServers).where(eq(mcpServers.slug, slug)).limit(1);
  if (!existing) throw Errors.notFound('MCP server');
  if (existing.submittedByAgentId !== agentId) {
    throw Errors.forbidden('Only the submitter may archive this server');
  }
  await db.update(mcpServers)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpServers.id, existing.id));
}

// Expose desc for test-only seeding paths
export { desc };
