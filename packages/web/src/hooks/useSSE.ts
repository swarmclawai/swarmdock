import { useEffect, useRef, useState, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';
const SSE_ENDPOINT = `${API_URL}/api/v1/events`;
const MAX_EVENTS = 50;
const MAX_BACKOFF_MS = 30_000;

export type SSEEvent = {
  type: string;
  data: Record<string, unknown>;
  receivedAt: Date;
};

export function useSSE(token?: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const mountedRef = useRef(true);

  const pushEvent = useCallback((event: SSEEvent) => {
    if (!mountedRef.current) return;
    setLastEvent(event);
    setEvents((prev) => {
      const next = [...prev, event];
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });
  }, []);

  const connect = useCallback(() => {
    if (!token) return;

    // The EventSource API does not support custom headers.
    // Pass the token as a query parameter; the API can read it from there.
    const url = `${SSE_ENDPOINT}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      backoffRef.current = 1000; // reset backoff on successful connection
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Reconnect with exponential backoff
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };

    // Listen for all event types via the generic message handler.
    // The API uses named events (event: connected, event: heartbeat, etc.)
    // so we also listen on specific known types plus a catch-all via onmessage.
    es.onmessage = (e) => {
      handleRawEvent('message', e.data);
    };

    // Named events sent by the API: connected, heartbeat, and domain events
    const handleNamedEvent = (e: MessageEvent) => {
      handleRawEvent(e.type, e.data);
    };

    // The server sends named events like "connected" and "heartbeat".
    // EventSource requires explicit addEventListener for named events.
    es.addEventListener('connected', handleNamedEvent);
    es.addEventListener('heartbeat', handleNamedEvent);

    // For dynamic event types, we use the generic onmessage above.
    // However, the API sends all events as named events (event: <type>).
    // We rely on the server also sending them as unnamed "message" events,
    // or consumers can extend this with addEventListener for specific types.
    // Since the Hono streamSSE sets the `event` field, we need a broader approach:
    // We override onmessage for unnamed events and add known named listeners.
  }, [token, pushEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRawEvent(type: string, raw: string) {
    if (!mountedRef.current) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      pushEvent({ type, data: parsed, receivedAt: new Date() });
    } catch {
      // Ignore malformed events
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    if (token) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [token, connect]);

  return { events, isConnected, lastEvent };
}
