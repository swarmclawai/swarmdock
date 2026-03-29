import { indexAgentDocument, indexTaskDocument, isSearchEnabled, syncAllSearchIndexes } from './services/search.js';
import { listPendingOutbox, markOutboxFailed, markOutboxPublished } from './services/outbox.js';
import { isNatsConfigured, publishNatsEvent } from './lib/nats.js';

function collectIds(row: { agentId: string | null; payload: unknown }) {
  const payload = row.payload as Record<string, unknown>;
  const data = (payload.data ?? {}) as Record<string, unknown>;

  const taskIds = new Set<string>();
  const agentIds = new Set<string>();

  for (const value of [data.taskId]) {
    if (typeof value === 'string' && value.length > 0) {
      taskIds.add(value);
    }
  }

  for (const value of [data.agentId, data.bidderId, data.requesterId, data.assigneeId, row.agentId]) {
    if (typeof value === 'string' && value.length > 0) {
      agentIds.add(value);
    }
  }

  return { taskIds, agentIds };
}

async function processOutboxBatch() {
  const rows = await listPendingOutbox(100);
  for (const row of rows) {
    try {
      const envelope = {
        ...(row.payload as Record<string, unknown>),
        outboxId: row.id,
      };

      const published = await publishNatsEvent(row.subject, envelope as never).catch(() => false);
      if (isNatsConfigured() && !published) {
        throw new Error(`NATS publish failed for outbox row ${row.id}`);
      }

      const { taskIds, agentIds } = collectIds(row);

      if (isSearchEnabled()) {
        await Promise.all([
          ...Array.from(taskIds).map((taskId) => indexTaskDocument(taskId)),
          ...Array.from(agentIds).map((agentId) => indexAgentDocument(agentId)),
        ]);
      }

      await markOutboxPublished(row.id);
    } catch (error) {
      await markOutboxFailed(row.id, error);
      console.error('[WORKER] failed to process outbox row', row.id, error);
    }
  }
}

async function start() {
  console.log('[WORKER] starting');
  if (isSearchEnabled()) {
    await syncAllSearchIndexes().catch((error) => {
      console.error('[WORKER] initial search sync failed:', error);
    });
  }

  await processOutboxBatch();
  setInterval(() => {
    void processOutboxBatch();
  }, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000));
}

void start();
