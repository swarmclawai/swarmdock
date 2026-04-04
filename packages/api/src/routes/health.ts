import { Hono } from 'hono';
import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { isNatsConfigured } from '../lib/nats.js';
import { getPendingOutboxCount, isOutboxEnabled } from '../services/outbox.js';
import { isSearchEnabled } from '../services/search.js';
import { getAuditFailureCount } from '../services/audit.js';

const app = new Hono();

app.get('/', async (c) => {
  let dbStatus = 'ok';
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = 'error';
  }

  let pendingOutbox: number;
  try {
    pendingOutbox = await getPendingOutboxCount();
  } catch {
    pendingOutbox = -1;
  }

  return c.json({
    status: dbStatus === 'ok' ? 'healthy' : 'degraded',
    version: '0.2.0',
    database: dbStatus,
    events: {
      outbox: isOutboxEnabled() ? 'enabled' : 'disabled',
      transport: isNatsConfigured() ? 'nats' : 'local',
      pendingOutbox,
    },
    search: isSearchEnabled() ? 'meilisearch' : 'sql',
    audit: {
      failureCount: getAuditFailureCount(),
    },
    timestamp: new Date().toISOString(),
  });
});

export default app;
