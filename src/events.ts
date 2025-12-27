export type EventHandler<T = unknown> = (payload: T) => void;

const handlers = new Map<string, Set<EventHandler>>();

export const events = {
  /**
   * Emit an event with optional payload
   */
  emit<T = unknown>(eventName: string, payload?: T): void {
    const eventHandlers = handlers.get(eventName);
    if (!eventHandlers) return;

    eventHandlers.forEach(handler => {
      try {
        handler(payload);
      } catch (e) {
        console.error(`Error in event handler for "${eventName}":`, e);
      }
    });
  },

  /**
   * Subscribe to an event
   */
  on<T = unknown>(eventName: string, handler: EventHandler<T>): void {
    if (!handlers.has(eventName)) {
      handlers.set(eventName, new Set());
    }
    handlers.get(eventName)!.add(handler as EventHandler);
  },

  /**
   * Unsubscribe from an event
   */
  off<T = unknown>(eventName: string, handler: EventHandler<T>): void {
    handlers.get(eventName)?.delete(handler as EventHandler);
  },

  /**
   * Subscribe to an event once (auto-unsubscribes after first call)
   */
  once<T = unknown>(eventName: string, handler: EventHandler<T>): void {
    const wrapper: EventHandler<T> = (payload) => {
      this.off(eventName, wrapper);
      handler(payload);
    };
    this.on(eventName, wrapper);
  },

  /**
   * Clear all handlers for an event, or all events if no name provided
   */
  clear(eventName?: string): void {
    if (eventName) {
      handlers.delete(eventName);
    } else {
      handlers.clear();
    }
  }
};
