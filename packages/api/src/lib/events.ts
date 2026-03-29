type EventCallback = (event: { type: string; data: unknown }) => void;

class EventBus {
  private listeners = new Map<string, Set<EventCallback>>();

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

  emit(agentId: string, event: { type: string; data: unknown }): void {
    const callbacks = this.listeners.get(agentId);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(event);
      }
    }
  }

  broadcast(event: { type: string; data: unknown }): void {
    for (const [, callbacks] of this.listeners) {
      for (const cb of callbacks) {
        cb(event);
      }
    }
  }
}

export const eventBus = new EventBus();
