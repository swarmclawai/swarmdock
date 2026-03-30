import { enqueueOutboxEvent, OUTBOX_TARGET, type EventEnvelope } from '../services/outbox.js';
import { subscribeNatsEvents } from './nats.js';
import { db } from '../db/client.js';
import { agentMessages } from '../db/schema.js';

type EventCallback = (event: EventEnvelope) => void | Promise<void>;

const INSTANCE_ID = crypto.randomUUID();
const RECENT_EVENT_TTL_MS = 5 * 60 * 1000;

function buildSubject(target: 'agent' | 'broadcast', agentId?: string) {
  return target === 'agent' && agentId ? `events.agent.${agentId}` : 'events.broadcast';
}

class EventBus {
  private listeners = new Map<string, Set<EventCallback>>();
  private recentEventIds = new Map<string, number>();
  private bridgeStarted = false;
  private unsubscribeBridge: (() => void) | null = null;

  subscribe(agentId: string, callback: EventCallback): () => void {
    if (!this.listeners.has(agentId)) {
      this.listeners.set(agentId, new Set());
    }
    this.listeners.get(agentId)!.add(callback);

    return () => {
      this.listeners.get(agentId)?.delete(callback);
      if (this.listeners.get(agentId)?.size === 0) {
        this.listeners.delete(agentId);
      }
    };
  }

  async startTransportBridge(): Promise<void> {
    if (this.bridgeStarted) {
      return;
    }

    this.bridgeStarted = true;
    this.unsubscribeBridge = await subscribeNatsEvents(async (_subject, event) => {
      if (event.originInstanceId === INSTANCE_ID) {
        return;
      }

      if (event.outboxId && this.isDuplicate(event.outboxId)) {
        return;
      }

      this.dispatch(event);
    });
  }

  stopTransportBridge(): void {
    this.unsubscribeBridge?.();
    this.unsubscribeBridge = null;
    this.bridgeStarted = false;
  }

  emit(agentId: string, event: { type: string; data: Record<string, unknown> }): void {
    const envelope: EventEnvelope = {
      type: event.type,
      data: event.data,
      timestamp: new Date().toISOString(),
      originInstanceId: INSTANCE_ID,
      target: OUTBOX_TARGET.AGENT,
      agentId,
    };

    this.dispatchToAgent(agentId, envelope);

    // Persist as a message for polling (A2A relay)
    void db.insert(agentMessages).values({
      recipientId: agentId,
      senderId: null,
      type: event.type,
      payload: event.data,
    }).catch((err) => {
      console.error('[EVENTS] failed to persist agent message:', err);
    });

    void enqueueOutboxEvent({
      subject: buildSubject('agent', agentId),
      target: OUTBOX_TARGET.AGENT,
      agentId,
      type: event.type,
      envelope,
    }).catch((error) => {
      console.error('[EVENTS] failed to enqueue agent event:', error);
    });
  }

  broadcast(event: { type: string; data: Record<string, unknown> }): void {
    const envelope: EventEnvelope = {
      type: event.type,
      data: event.data,
      timestamp: new Date().toISOString(),
      originInstanceId: INSTANCE_ID,
      target: OUTBOX_TARGET.BROADCAST,
      agentId: null,
    };

    this.dispatchBroadcast(envelope);
    void enqueueOutboxEvent({
      subject: buildSubject('broadcast'),
      target: OUTBOX_TARGET.BROADCAST,
      type: event.type,
      envelope,
    }).catch((error) => {
      console.error('[EVENTS] failed to enqueue broadcast event:', error);
    });
  }

  private dispatch(event: EventEnvelope): void {
    if (event.target === OUTBOX_TARGET.AGENT && event.agentId) {
      this.dispatchToAgent(event.agentId, event);
      return;
    }

    this.dispatchBroadcast(event);
  }

  private dispatchToAgent(agentId: string, event: EventEnvelope): void {
    const callbacks = this.listeners.get(agentId);
    if (!callbacks) {
      return;
    }

    for (const callback of callbacks) {
      void callback(event);
    }
  }

  private dispatchBroadcast(event: EventEnvelope): void {
    for (const callbacks of this.listeners.values()) {
      for (const callback of callbacks) {
        void callback(event);
      }
    }
  }

  private isDuplicate(outboxId: string): boolean {
    const now = Date.now();
    for (const [seenId, seenAt] of this.recentEventIds.entries()) {
      if (now - seenAt > RECENT_EVENT_TTL_MS) {
        this.recentEventIds.delete(seenId);
      }
    }

    if (this.recentEventIds.has(outboxId)) {
      return true;
    }

    this.recentEventIds.set(outboxId, now);
    return false;
  }
}

export const eventBus = new EventBus();
