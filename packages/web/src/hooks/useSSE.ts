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

/**
 * Parse a raw SSE text chunk into individual frames.
 * Each frame is separated by a blank line. Fields are `event:` and `data:`.
 * Returns an array of { event, data } pairs.
 */
function parseSSEFrames(chunk: string): Array<{ event: string; data: string }> {
  const frames: Array<{ event: string; data: string }> = [];
  // Split on double newline (the SSE frame boundary)
  const rawFrames = chunk.split(/\n\n/);

  for (const raw of rawFrames) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    let event = 'message';
    const dataLines: string[] = [];

    for (const line of trimmed.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
      // Ignore id:, retry:, and comment lines for now
    }

    if (dataLines.length > 0) {
      frames.push({ event, data: dataLines.join('\n') });
    }
  }

  return frames;
}

export function useSSE(token?: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);

  const abortRef = useRef<AbortController | null>(null);
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

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) connectFn();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (!token) return;

    const controller = new AbortController();
    abortRef.current = controller;

    // Use fetch + ReadableStream instead of EventSource so we can:
    // 1. Send the Authorization header (EventSource does not support custom headers)
    // 2. Capture all named event types without pre-registering listeners
    fetch(SSE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    })
      .then((response) => {
        if (!mountedRef.current) return;

        if (!response.ok || !response.body) {
          setIsConnected(false);
          scheduleReconnect(connect);
          return;
        }

        setIsConnected(true);
        backoffRef.current = 1000; // reset on successful connection

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function read(): Promise<void> {
          return reader.read().then(({ done, value }) => {
            if (done || !mountedRef.current) {
              if (mountedRef.current) {
                setIsConnected(false);
                scheduleReconnect(connect);
              }
              return;
            }

            buffer += decoder.decode(value, { stream: true });

            // Process complete frames (delimited by double newline)
            const lastDoubleNewline = buffer.lastIndexOf('\n\n');
            if (lastDoubleNewline !== -1) {
              const complete = buffer.slice(0, lastDoubleNewline + 2);
              buffer = buffer.slice(lastDoubleNewline + 2);

              const frames = parseSSEFrames(complete);
              for (const frame of frames) {
                try {
                  const parsed = JSON.parse(frame.data) as Record<string, unknown>;
                  pushEvent({
                    type: frame.event,
                    data: parsed,
                    receivedAt: new Date(),
                  });
                } catch {
                  // Ignore malformed JSON
                }
              }
            }

            return read();
          });
        }

        return read();
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        // AbortError is expected on cleanup; don't reconnect
        if (err instanceof DOMException && err.name === 'AbortError') return;

        setIsConnected(false);
        scheduleReconnect(connect);
      });
  }, [token, pushEvent, scheduleReconnect]);

  useEffect(() => {
    mountedRef.current = true;

    if (token) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [token, connect]);

  return { events, isConnected, lastEvent };
}
