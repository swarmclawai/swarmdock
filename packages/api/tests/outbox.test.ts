import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueOutboxEvent, isOutboxEnabled, OUTBOX_TARGET } from '../src/services/outbox.ts';

test('outbox can be disabled explicitly for isolated tests', async () => {
  const previousValue = process.env.ENABLE_EVENT_OUTBOX;
  process.env.ENABLE_EVENT_OUTBOX = '0';

  try {
    assert.equal(isOutboxEnabled(), false);

    const result = await enqueueOutboxEvent({
      subject: 'events.broadcast',
      target: OUTBOX_TARGET.BROADCAST,
      type: 'task.updated',
      envelope: {
        type: 'task.updated',
        data: { taskId: 'task-123' },
        timestamp: new Date().toISOString(),
        originInstanceId: 'test-instance',
        target: OUTBOX_TARGET.BROADCAST,
        agentId: null,
      },
    });

    assert.equal(result, null);
  } finally {
    if (previousValue === undefined) {
      delete process.env.ENABLE_EVENT_OUTBOX;
    } else {
      process.env.ENABLE_EVENT_OUTBOX = previousValue;
    }
  }
});
