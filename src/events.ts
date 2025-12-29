// Types
export type EventCallback<T = unknown> = (payload: T) => void;
export type DOMEventCallback = (event: Event) => void;

interface ListenerEntry {
  type: 'custom' | 'dom';
  event: string;
  callback: EventCallback | DOMEventCallback;
  selector?: string | Document;
  originalCallback?: EventCallback | DOMEventCallback; // For once() wrappers
}

// Central listener registry
const listeners: ListenerEntry[] = [];
const customHandlers = new Map<string, Set<EventCallback>>();

// Track realtime subscriptions (collection -> listener count)
const realtimeCollections = new Map<string, number>();

// DOM event delegation handler (attached to document)
const domDelegationHandlers = new Map<string, (e: Event) => void>();

// Reference to db module (set via setDbModule to avoid circular imports)
let dbModule: {
  enableRealtime: (collection: string) => Promise<void>;
  disableRealtime: (collection: string) => Promise<void>;
} | null = null;

/**
 * Set the db module reference (called from db.ts to avoid circular imports)
 */
export function setDbModule(db: typeof dbModule): void {
  dbModule = db;
}

/**
 * Parse a db event name to extract collection and action
 * Returns null if not a db event
 */
function parseDbEvent(eventName: string): { collection: string; action: string } | null {
  const match = eventName.match(/^db:([^:]+):(create|update|delete)$/);
  if (match) {
    return { collection: match[1], action: match[2] };
  }
  return null;
}

/**
 * Setup DOM event delegation for an event type
 */
function ensureDomDelegation(eventType: string): void {
  if (domDelegationHandlers.has(eventType)) return;

  const handler = (e: Event) => {
    // Find all listeners for this event type
    for (const entry of listeners) {
      if (entry.type !== 'dom' || entry.event !== eventType) continue;

      // Check if target matches selector
      if (entry.selector === document) {
        (entry.callback as DOMEventCallback)(e);
      } else if (typeof entry.selector === 'string') {
        const target = e.target as Element;
        if (target?.matches?.(entry.selector) || target?.closest?.(entry.selector)) {
          (entry.callback as DOMEventCallback)(e);
        }
      }
    }
  };

  document.addEventListener(eventType, handler, true);
  domDelegationHandlers.set(eventType, handler);
}

/**
 * Remove DOM delegation if no more listeners for an event type
 */
function cleanupDomDelegation(eventType: string): void {
  const hasListeners = listeners.some(l => l.type === 'dom' && l.event === eventType);
  if (!hasListeners) {
    const handler = domDelegationHandlers.get(eventType);
    if (handler) {
      document.removeEventListener(eventType, handler, true);
      domDelegationHandlers.delete(eventType);
    }
  }
}

/**
 * Handle realtime subscription when db:* listener added
 */
async function handleRealtimeAdd(collection: string): Promise<void> {
  const count = (realtimeCollections.get(collection) || 0) + 1;
  realtimeCollections.set(collection, count);

  // First listener for this collection - enable realtime
  if (count === 1 && dbModule) {
    await dbModule.enableRealtime(collection);
  }
}

/**
 * Handle realtime unsubscription when db:* listener removed
 */
async function handleRealtimeRemove(collection: string): Promise<void> {
  const count = (realtimeCollections.get(collection) || 1) - 1;

  if (count <= 0) {
    realtimeCollections.delete(collection);
    // Last listener removed - disable realtime
    if (dbModule) {
      await dbModule.disableRealtime(collection);
    }
  } else {
    realtimeCollections.set(collection, count);
  }
}

export const events = {
  /**
   * Subscribe to an event
   * @param event - Event name (custom) or DOM event type
   * @param selectorOrCallback - CSS selector for DOM events, or callback for custom events
   * @param callback - Callback for DOM events
   */
  on(
    event: string,
    selectorOrCallback: string | Document | EventCallback,
    callback?: DOMEventCallback
  ): void {
    // DOM event: on('click', '#btn', callback) or on('keydown', document, callback)
    if (callback !== undefined) {
      const selector = selectorOrCallback as string | Document;
      const entry: ListenerEntry = { type: 'dom', event, callback, selector };
      listeners.push(entry);
      ensureDomDelegation(event);
      return;
    }

    // Custom event: on('auth:login', callback)
    const cb = selectorOrCallback as EventCallback;
    const entry: ListenerEntry = { type: 'custom', event, callback: cb };
    listeners.push(entry);

    if (!customHandlers.has(event)) {
      customHandlers.set(event, new Set());
    }
    customHandlers.get(event)!.add(cb);

    // Check for db:* events to enable realtime
    const dbEvent = parseDbEvent(event);
    if (dbEvent) {
      handleRealtimeAdd(dbEvent.collection);
    }
  },

  /**
   * Unsubscribe from an event
   */
  off(
    event: string,
    selectorOrCallback: string | Document | EventCallback,
    callback?: DOMEventCallback
  ): void {
    // DOM event
    if (callback !== undefined) {
      const selector = selectorOrCallback as string | Document;
      const index = listeners.findIndex(
        l => l.type === 'dom' && l.event === event && l.selector === selector &&
        (l.callback === callback || l.originalCallback === callback)
      );
      if (index !== -1) {
        listeners.splice(index, 1);
        cleanupDomDelegation(event);
      }
      return;
    }

    // Custom event
    const cb = selectorOrCallback as EventCallback;
    const index = listeners.findIndex(
      l => l.type === 'custom' && l.event === event &&
      (l.callback === cb || l.originalCallback === cb)
    );
    if (index !== -1) {
      const entry = listeners[index];
      listeners.splice(index, 1);
      customHandlers.get(event)?.delete(entry.callback as EventCallback);
      if (entry.originalCallback) {
        customHandlers.get(event)?.delete(entry.originalCallback as EventCallback);
      }

      // Check for db:* events to disable realtime
      const dbEvent = parseDbEvent(event);
      if (dbEvent) {
        handleRealtimeRemove(dbEvent.collection);
      }
    }
  },

  /**
   * Subscribe to an event once (auto-unsubscribes after first call)
   */
  once(
    event: string,
    selectorOrCallback: string | Document | EventCallback,
    callback?: DOMEventCallback
  ): void {
    if (callback !== undefined) {
      // DOM event
      const selector = selectorOrCallback as string | Document;
      const wrapper: DOMEventCallback = (e) => {
        this.off(event, selector, wrapper);
        callback(e);
      };
      const entry: ListenerEntry = {
        type: 'dom',
        event,
        callback: wrapper,
        selector,
        originalCallback: callback
      };
      listeners.push(entry);
      ensureDomDelegation(event);
    } else {
      // Custom event
      const cb = selectorOrCallback as EventCallback;
      const wrapper: EventCallback = (payload) => {
        this.off(event, wrapper);
        cb(payload);
      };
      const entry: ListenerEntry = {
        type: 'custom',
        event,
        callback: wrapper,
        originalCallback: cb
      };
      listeners.push(entry);

      if (!customHandlers.has(event)) {
        customHandlers.set(event, new Set());
      }
      customHandlers.get(event)!.add(wrapper);

      const dbEvent = parseDbEvent(event);
      if (dbEvent) {
        handleRealtimeAdd(dbEvent.collection);
      }
    }
  },

  /**
   * Emit a custom event
   */
  emit<T = unknown>(event: string, payload?: T): void {
    const handlers = customHandlers.get(event);
    if (!handlers) return;

    handlers.forEach(handler => {
      try {
        handler(payload);
      } catch (e) {
        console.error(`Error in event handler for "${event}":`, e);
      }
    });
  },

  /**
   * Clear all handlers for an event, or all events if no name provided
   */
  clear(event?: string): void {
    if (event) {
      // Clear specific event
      const toRemove = listeners.filter(l => l.event === event);
      toRemove.forEach(entry => {
        const index = listeners.indexOf(entry);
        if (index !== -1) listeners.splice(index, 1);
      });
      customHandlers.delete(event);

      if (toRemove.some(l => l.type === 'dom')) {
        cleanupDomDelegation(event);
      }

      const dbEvent = parseDbEvent(event);
      if (dbEvent && realtimeCollections.has(dbEvent.collection)) {
        realtimeCollections.delete(dbEvent.collection);
        dbModule?.disableRealtime(dbEvent.collection);
      }
    } else {
      // Clear all
      listeners.length = 0;
      customHandlers.clear();

      // Cleanup all DOM delegations
      domDelegationHandlers.forEach((handler, eventType) => {
        document.removeEventListener(eventType, handler, true);
      });
      domDelegationHandlers.clear();

      // Disable all realtime
      realtimeCollections.forEach((_, collection) => {
        dbModule?.disableRealtime(collection);
      });
      realtimeCollections.clear();
    }
  },

  /**
   * List all active listeners (for debugging)
   */
  list(): { type: string; event: string; selector?: string }[] {
    return listeners.map(l => ({
      type: l.type,
      event: l.event,
      selector: l.selector === document ? 'document' : l.selector as string | undefined
    }));
  }
};
