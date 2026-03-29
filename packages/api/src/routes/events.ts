import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { eventBus } from '../lib/events.js';

const app = new Hono<AuthContext>();

// GET /api/v1/events — SSE event stream
app.get('/', authMiddleware, async (c) => {
  const agent = c.get('agent');

  return streamSSE(c, async (stream) => {
    // Send initial connection event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ agentId: agent.agent_id, timestamp: new Date().toISOString() }),
    });

    const unsubscribe = eventBus.subscribe(agent.agent_id, async (event) => {
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify({ ...event.data as object, timestamp: new Date().toISOString() }),
        });
      } catch {
        // Stream closed
      }
    });

    // Keep alive with periodic heartbeat
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ timestamp: new Date().toISOString() }),
        });
      } catch {
        clearInterval(heartbeat);
      }
    }, 30000);

    // Clean up on disconnect
    stream.onAbort(() => {
      unsubscribe();
      clearInterval(heartbeat);
    });

    // Keep stream open
    await new Promise(() => {}); // Never resolves — stream stays open until client disconnects
  });
});

export default app;
