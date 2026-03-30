import { Hono } from 'hono';
import { db } from '../db/client.js';
import { agentMessages, agents } from '../db/schema.js';
import { eq, and, isNull, gt, desc, sql } from 'drizzle-orm';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';

const app = new Hono<AuthContext>();

/**
 * GET /api/v1/a2a/messages — Poll for unread messages
 *
 * Query params:
 *   since: UUID cursor — return messages after this ID
 *   limit: max results (default 50, max 100)
 *   ack: if "true", mark returned messages as read
 */
app.get('/messages', authMiddleware, async (c) => {
  const agent = c.get('agent');
  const since = c.req.query('since');
  const ack = c.req.query('ack') === 'true';
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 100));

  const conditions = [
    eq(agentMessages.recipientId, agent.agent_id),
    isNull(agentMessages.readAt),
  ];

  if (since) {
    // Get the createdAt of the cursor message for pagination
    const [cursor] = await db
      .select({ createdAt: agentMessages.createdAt })
      .from(agentMessages)
      .where(eq(agentMessages.id, since))
      .limit(1);

    if (cursor) {
      conditions.push(gt(agentMessages.createdAt, cursor.createdAt));
    }
  }

  const messages = await db
    .select()
    .from(agentMessages)
    .where(and(...conditions))
    .orderBy(agentMessages.createdAt)
    .limit(limit);

  // Acknowledge (mark as read) if requested
  if (ack && messages.length > 0) {
    const messageIds = messages.map((m) => m.id);
    await db
      .update(agentMessages)
      .set({ readAt: new Date() })
      .where(sql`id = ANY(${messageIds})`);
  }

  return c.json({
    messages,
    count: messages.length,
    cursor: messages.length > 0 ? messages[messages.length - 1].id : null,
  });
});

/**
 * POST /api/v1/a2a/messages — Send a message to another agent
 */
app.post('/messages', authMiddleware, async (c) => {
  const sender = c.get('agent');
  const body = await c.req.json() as { recipientId?: string; type?: string; payload?: unknown };

  if (!body.recipientId || !body.type || !body.payload) {
    return c.json({ error: 'recipientId, type, and payload are required' }, 400);
  }

  // Verify recipient exists
  const [recipient] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, body.recipientId))
    .limit(1);

  if (!recipient) {
    return c.json({ error: 'Recipient agent not found' }, 404);
  }

  const [message] = await db
    .insert(agentMessages)
    .values({
      recipientId: body.recipientId,
      senderId: sender.agent_id,
      type: body.type,
      payload: body.payload,
    })
    .returning();

  return c.json(message, 201);
});

/**
 * POST /api/v1/a2a/messages/ack — Acknowledge (mark as read) specific messages
 */
app.post('/messages/ack', authMiddleware, async (c) => {
  const agent = c.get('agent');
  const body = await c.req.json() as { messageIds?: string[] };

  if (!body.messageIds?.length) {
    return c.json({ error: 'messageIds array required' }, 400);
  }

  const result = await db
    .update(agentMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(agentMessages.recipientId, agent.agent_id),
        sql`id = ANY(${body.messageIds})`,
      ),
    );

  return c.json({ acknowledged: true });
});

/**
 * GET /api/v1/a2a/messages/count — Count unread messages
 */
app.get('/messages/count', authMiddleware, async (c) => {
  const agent = c.get('agent');

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.recipientId, agent.agent_id),
        isNull(agentMessages.readAt),
      ),
    );

  return c.json({ unread: Number(result.count) });
});

export default app;
