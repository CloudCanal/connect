// Types
export type EventCallback<T = unknown> = (payload: T) => void;

interface ListenerEntry {
  event: string;
  callback: EventCallback;
  originalCallback?: EventCallback; // For once() wrappers
}

// Central listener registry
const listeners: ListenerEntry[] = [];
const customHandlers = new Map<string, Set<EventCallback>>();

// Track realtime subscriptions (collection -> listener count)
const realtimeCollections = new Map<string, number>();

// Track record-specific subscriptions (collection:id -> listener count)
const realtimeRecords = new Map<string, number>();

// Reference to db module (set via setDbModule to avoid circular imports)
let dbModule: {
  enableRealtime: (collection: string) => Promise<void>;
  disableRealtime: (collection: string) => Promise<void>;
  enableRealtimeRecord: (collection: string, id: string) => Promise<void>;
  disableRealtimeRecord: (collection: string, id: string) => Promise<void>;
} | null = null;

/**
 * Set the db module reference (called from db.ts to avoid circular imports)
 */
export function setDbModule(db: typeof dbModule): void {
  dbModule = db;
}

/**
 * Parse a db event name to extract collection, action, and optional record ID
 * Returns null if not a db event
 * Format: db:{collection}:{action} or db:{collection}:{action}:{id}
 */
function parseDbEvent(eventName: string): { collection: string; action: string; id?: string } | null {
  const match = eventName.match(/^db:([^:]+):(create|update|delete)(?::(.+))?$/);
  if (match) {
    return {
      collection: match[1],
      action: match[2],
      id: match[3] // undefined if not present
    };
  }
  return null;
}

/**
 * Handle realtime subscription when db:* listener added
 */
async function handleRealtimeAdd(collection: string, id?: string): Promise<void> {
  // Record-specific subscription (only for update/delete, not create)
  if (id) {
    const key = `${collection}:${id}`;
    const count = (realtimeRecords.get(key) || 0) + 1;
    realtimeRecords.set(key, count);

    // First listener for this record - enable realtime
    if (count === 1 && dbModule) {
      await dbModule.enableRealtimeRecord(collection, id);
    }
    return;
  }

  // Collection-wide subscription
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
async function handleRealtimeRemove(collection: string, id?: string): Promise<void> {
  // Record-specific subscription
  if (id) {
    const key = `${collection}:${id}`;
    const count = (realtimeRecords.get(key) || 1) - 1;

    if (count <= 0) {
      realtimeRecords.delete(key);
      // Last listener removed - disable realtime for this record
      if (dbModule) {
        await dbModule.disableRealtimeRecord(collection, id);
      }
    } else {
      realtimeRecords.set(key, count);
    }
    return;
  }

  // Collection-wide subscription
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
   */
  on(event: string, callback: EventCallback): void {
    const entry: ListenerEntry = { event, callback };
    listeners.push(entry);

    if (!customHandlers.has(event)) {
      customHandlers.set(event, new Set());
    }
    customHandlers.get(event)!.add(callback);

    // Check for db:* events to enable realtime
    const dbEvent = parseDbEvent(event);
    if (dbEvent) {
      // Only allow record ID for update/delete (can't subscribe to non-existent record for create)
      const id = dbEvent.action !== 'create' ? dbEvent.id : undefined;
      handleRealtimeAdd(dbEvent.collection, id);
    }
  },

  /**
   * Unsubscribe from an event
   */
  off(event: string, callback: EventCallback): void {
    const index = listeners.findIndex(
      l => l.event === event &&
      (l.callback === callback || l.originalCallback === callback)
    );
    if (index !== -1) {
      const entry = listeners[index];
      listeners.splice(index, 1);
      customHandlers.get(event)?.delete(entry.callback);
      if (entry.originalCallback) {
        customHandlers.get(event)?.delete(entry.originalCallback);
      }

      // Check for db:* events to disable realtime
      const dbEvent = parseDbEvent(event);
      if (dbEvent) {
        const id = dbEvent.action !== 'create' ? dbEvent.id : undefined;
        handleRealtimeRemove(dbEvent.collection, id);
      }
    }
  },

  /**
   * Subscribe to an event once (auto-unsubscribes after first call)
   */
  once(event: string, callback: EventCallback): void {
    const wrapper: EventCallback = (payload) => {
      this.off(event, wrapper);
      callback(payload);
    };
    const entry: ListenerEntry = {
      event,
      callback: wrapper,
      originalCallback: callback
    };
    listeners.push(entry);

    if (!customHandlers.has(event)) {
      customHandlers.set(event, new Set());
    }
    customHandlers.get(event)!.add(wrapper);

    const dbEvent = parseDbEvent(event);
    if (dbEvent) {
      const id = dbEvent.action !== 'create' ? dbEvent.id : undefined;
      handleRealtimeAdd(dbEvent.collection, id);
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

      const dbEvent = parseDbEvent(event);
      if (dbEvent) {
        const id = dbEvent.action !== 'create' ? dbEvent.id : undefined;
        if (id) {
          const key = `${dbEvent.collection}:${id}`;
          if (realtimeRecords.has(key)) {
            realtimeRecords.delete(key);
            dbModule?.disableRealtimeRecord(dbEvent.collection, id);
          }
        } else if (realtimeCollections.has(dbEvent.collection)) {
          realtimeCollections.delete(dbEvent.collection);
          dbModule?.disableRealtime(dbEvent.collection);
        }
      }
    } else {
      // Clear all
      listeners.length = 0;
      customHandlers.clear();

      // Disable all collection-wide realtime
      realtimeCollections.forEach((_, collection) => {
        dbModule?.disableRealtime(collection);
      });
      realtimeCollections.clear();

      // Disable all record-specific realtime
      realtimeRecords.forEach((_, key) => {
        const [collection, id] = key.split(':');
        dbModule?.disableRealtimeRecord(collection, id);
      });
      realtimeRecords.clear();
    }
  },

  /**
   * List all active listeners (for debugging)
   */
  list(): { event: string }[] {
    return listeners.map(l => ({
      event: l.event
    }));
  }
};
