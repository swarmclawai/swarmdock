import { Hono } from 'hono';
import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';

const app = new Hono();

app.get('/', async (c) => {
  let dbStatus = 'ok';
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = 'error';
  }

  return c.json({
    status: dbStatus === 'ok' ? 'healthy' : 'degraded',
    version: '0.1.0',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

export default app;
