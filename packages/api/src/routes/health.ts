import { Hono } from 'hono';
import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { isNatsConfigured } from '../lib/nats.js';
import { getPendingOutboxCount, isOutboxEnabled } from '../services/outbox.js';
import { isSearchEnabled } from '../services/search.js';

const app = new Hono();

app.get('/', async (c) => {
  let dbStatus = 'ok';
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = 'error';
  }

  let pendingOutbox = 0;
  try {
    pendingOutbox = await getPendingOutboxCount();
  } catch {
    pendingOutbox = -1;
  }

  return c.json({
    status: dbStatus === 'ok' ? 'healthy' : 'degraded',
    version: '0.1.0',
    database: dbStatus,
    events: {
      outbox: isOutboxEnabled() ? 'enabled' : 'disabled',
      transport: isNatsConfigured() ? 'nats' : 'local',
      pendingOutbox,
    },
    search: isSearchEnabled() ? 'meilisearch' : 'sql',
    timestamp: new Date().toISOString(),
  });
});

export default app;
