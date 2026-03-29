import {
  JSONCodec,
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  AckPolicy,
  DeliverPolicy,
  RetentionPolicy,
  type ConsumerMessages,
} from 'nats';
import type { EventEnvelope } from '../services/outbox.js';

const codec = JSONCodec<EventEnvelope>();
let connectionPromise: Promise<NatsConnection | null> | null = null;

const STREAM_NAME = 'SWARMDOCK';
const STREAM_SUBJECTS = [
  'swarmdock.agents.>',
  'swarmdock.tasks.>',
  'swarmdock.payments.>',
  'swarmdock.ratings.>',
  'swarmdock.broadcast',
];

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

/**
 * Ensure the JetStream stream exists with the expected configuration.
 * Creates it if missing, updates subjects if they differ.
 */
async function ensureStream(jsm: JetStreamManager): Promise<void> {
  try {
    const info = await jsm.streams.info(STREAM_NAME);
    // Update subjects if needed
    const currentSubjects = info.config.subjects ?? [];
    const needsUpdate = STREAM_SUBJECTS.some((s) => !currentSubjects.includes(s));
    if (needsUpdate) {
      await jsm.streams.update(STREAM_NAME, {
        ...info.config,
        subjects: STREAM_SUBJECTS,
      });
    }
  } catch {
    // Stream doesn't exist — create it
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: STREAM_SUBJECTS,
      retention: RetentionPolicy.Limits,
      max_msgs: 1_000_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
      max_bytes: 512 * 1024 * 1024, // 512 MiB
      num_replicas: 1,
    });
    console.log('[NATS] created JetStream stream:', STREAM_NAME);
  }
}

/**
 * Map an outbox subject like "events.agent.{id}" to a JetStream subject.
 */
export function toJetStreamSubject(outboxSubject: string): string {
  if (outboxSubject === 'events.broadcast') return 'swarmdock.broadcast';
  if (outboxSubject.startsWith('events.agent.')) {
    const agentId = outboxSubject.slice('events.agent.'.length);
    return `swarmdock.agents.${agentId}`;
  }
  // Pass through if already in JetStream format
  if (outboxSubject.startsWith('swarmdock.')) return outboxSubject;
  return `swarmdock.broadcast`;
}

/**
 * Publish an event to JetStream with at-least-once delivery guarantee.
 */
export async function publishNatsEvent(subject: string, event: EventEnvelope): Promise<boolean> {
  const nc = await getNatsConnection();
  if (!nc) return false;

  try {
    const jsm = await nc.jetstreamManager();
    await ensureStream(jsm);
    const js = nc.jetstream();

    const jsSubject = toJetStreamSubject(subject);
    await js.publish(jsSubject, codec.encode(event));
    return true;
  } catch (error) {
    console.error('[NATS] JetStream publish failed:', error);
    return false;
  }
}

/**
 * Subscribe to events using a JetStream durable consumer.
 * Messages are acked after successful handler execution.
 * On handler failure, messages are nacked for redelivery.
 */
export async function subscribeNatsEvents(
  onEvent: (subject: string, event: EventEnvelope) => void | Promise<void>,
  consumerName = 'swarmdock-worker',
): Promise<() => void> {
  const nc = await getNatsConnection();
  if (!nc) return () => {};

  let consumer: ConsumerMessages | null = null;

  try {
    const jsm = await nc.jetstreamManager();
    await ensureStream(jsm);

    // Ensure durable consumer exists
    try {
      await jsm.consumers.info(STREAM_NAME, consumerName);
    } catch {
      await jsm.consumers.add(STREAM_NAME, {
        durable_name: consumerName,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
        filter_subjects: STREAM_SUBJECTS,
        max_deliver: 5,
        ack_wait: 30 * 1_000_000_000, // 30s in nanoseconds
      });
      console.log('[NATS] created durable consumer:', consumerName);
    }

    const js = nc.jetstream();
    consumer = await js.consumers.get(STREAM_NAME, consumerName).then((c) => c.consume());

    void (async () => {
      for await (const msg of consumer!) {
        try {
          const event = codec.decode(msg.data);
          await onEvent(msg.subject, event);
          msg.ack();
        } catch (error) {
          console.error('[NATS] event handler failed, nacking for redelivery:', error);
          msg.nak();
        }
      }
    })();
  } catch (error) {
    console.error('[NATS] JetStream subscription setup failed, falling back to basic sub:', error);
    // Fallback to basic pub/sub if JetStream isn't available
    return subscribeBasic(nc, onEvent);
  }

  return () => {
    consumer?.stop();
  };
}

/**
 * Fallback: basic pub/sub for environments without JetStream.
 */
function subscribeBasic(
  nc: NatsConnection,
  onEvent: (subject: string, event: EventEnvelope) => void | Promise<void>,
): () => void {
  const subs = [
    nc.subscribe('events.agent.*'),
    nc.subscribe('events.broadcast'),
  ];

  let closed = false;
  for (const sub of subs) {
    void (async () => {
      for await (const msg of sub) {
        if (closed) break;
        try {
          await onEvent(msg.subject, codec.decode(msg.data));
        } catch (error) {
          console.error('[NATS] event handler failed:', error);
        }
      }
    })();
  }

  return () => {
    closed = true;
    for (const sub of subs) sub.unsubscribe();
  };
}
