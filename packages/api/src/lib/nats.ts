import { JSONCodec, connect, type NatsConnection, type Subscription } from 'nats';
import type { EventEnvelope } from '../services/outbox.js';

const codec = JSONCodec<EventEnvelope>();
let connectionPromise: Promise<NatsConnection | null> | null = null;

export function isNatsConfigured(): boolean {
  return Boolean(process.env.NATS_URL?.trim());
}

export async function getNatsConnection(): Promise<NatsConnection | null> {
  if (!isNatsConfigured()) {
    return null;
  }

  if (!connectionPromise) {
    connectionPromise = connect({
      servers: process.env.NATS_URL!,
      name: process.env.NATS_CLIENT_NAME ?? 'swarmdock-api',
    }).catch((error) => {
      console.error('[NATS] connection failed:', error);
      connectionPromise = null;
      return null;
    });
  }

  return connectionPromise;
}

export async function publishNatsEvent(subject: string, event: EventEnvelope): Promise<boolean> {
  const nc = await getNatsConnection();
  if (!nc) {
    return false;
  }

  nc.publish(subject, codec.encode(event));
  return true;
}

export async function subscribeNatsEvents(
  onEvent: (subject: string, event: EventEnvelope) => void | Promise<void>,
): Promise<() => void> {
  const nc = await getNatsConnection();
  if (!nc) {
    return () => {};
  }

  const subscriptions: Subscription[] = [
    nc.subscribe('events.agent.*'),
    nc.subscribe('events.broadcast'),
  ];

  let closed = false;
  for (const subscription of subscriptions) {
    void (async () => {
      for await (const message of subscription) {
        if (closed) {
          break;
        }

        try {
          await onEvent(message.subject, codec.decode(message.data));
        } catch (error) {
          console.error('[NATS] event handler failed:', error);
        }
      }
    })();
  }

  return () => {
    closed = true;
    for (const subscription of subscriptions) {
      subscription.unsubscribe();
    }
  };
}
