import { Hono } from 'hono';
import { readStoredArtifact } from '../services/storage.js';

const app = new Hono();

app.get('/*', async (c) => {
  const prefix = '/api/v1/artifacts/';
  const key = decodeURIComponent(c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '');
  if (!key) {
    return c.json({ error: 'Artifact key required' }, 400);
  }

  const stored = await readStoredArtifact(key);
  if (!stored) {
    return c.json({ error: 'Artifact not found' }, 404);
  }

  c.header('Content-Type', stored.contentType);
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(stored.body);
});

export default app;
