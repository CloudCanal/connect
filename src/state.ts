export interface StateOptions {
  persistence?: 'window' | 'session' | 'local';
  expiry?: number; // milliseconds from now
}

interface StateStore {
  value: unknown;
  expiry?: number;
  persistence: string;
}

type StateCallback = (value: unknown, oldValue: unknown) => void;

const subscribers = new Map<string, Set<StateCallback>>();
const memoryStore = new Map<string, StateStore>();
const STORAGE_PREFIX = 'cc:';

function getStorage(persistence: string): Storage | null {
  switch (persistence) {
    case 'session':
      return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    case 'local':
      return typeof localStorage !== 'undefined' ? localStorage : null;
    default:
      return null; // window/memory
  }
}

function isExpired(store: StateStore): boolean {
  return store.expiry !== undefined && Date.now() > store.expiry;
}

export const state = {
  /**
   * Get a value from state
   */
  get<T = unknown>(key: string): T | undefined {
    // Check memory first
    const mem = memoryStore.get(key);
    if (mem) {
      if (isExpired(mem)) {
        this.delete(key);
        return undefined;
      }
      return mem.value as T;
    }

    // Check persistent stores (session first, then local)
    for (const storageType of ['session', 'local'] as const) {
      const storage = getStorage(storageType);
      if (!storage) continue;

      const raw = storage.getItem(`${STORAGE_PREFIX}${key}`);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as StateStore;
          if (isExpired(parsed)) {
            storage.removeItem(`${STORAGE_PREFIX}${key}`);
            continue;
          }
          return parsed.value as T;
        } catch {
          // Invalid JSON, remove it
          storage.removeItem(`${STORAGE_PREFIX}${key}`);
        }
      }
    }

    return undefined;
  },

  /**
   * Set a value in state
   */
  set(key: string, value: unknown, options: StateOptions = {}): void {
    const { persistence = 'window', expiry } = options;
    const oldValue = this.get(key);

    const store: StateStore = {
      value,
      persistence,
      expiry: expiry ? Date.now() + expiry : undefined
    };

    const storage = getStorage(persistence);
    if (storage) {
      storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(store));
    } else {
      memoryStore.set(key, store);
    }

    // Notify subscribers
    const subs = subscribers.get(key);
    if (subs) {
      subs.forEach(cb => {
        try {
          cb(value, oldValue);
        } catch (e) {
          console.error(`Error in state subscriber for "${key}":`, e);
        }
      });
    }
  },

  /**
   * Check if a key exists in state
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  },

  /**
   * Delete a key from state
   */
  delete(key: string): void {
    const oldValue = this.get(key);

    // Remove from all stores
    memoryStore.delete(key);

    const session = getStorage('session');
    const local = getStorage('local');

    session?.removeItem(`${STORAGE_PREFIX}${key}`);
    local?.removeItem(`${STORAGE_PREFIX}${key}`);

    // Notify subscribers of deletion
    const subs = subscribers.get(key);
    if (subs && oldValue !== undefined) {
      subs.forEach(cb => {
        try {
          cb(undefined, oldValue);
        } catch (e) {
          console.error(`Error in state subscriber for "${key}":`, e);
        }
      });
    }
  },

  /**
   * Subscribe to changes on a key
   */
  subscribe(key: string, callback: StateCallback): void {
    if (!subscribers.has(key)) {
      subscribers.set(key, new Set());
    }
    subscribers.get(key)!.add(callback);
  },

  /**
   * Unsubscribe from changes on a key
   */
  unsubscribe(key: string, callback: StateCallback): void {
    subscribers.get(key)?.delete(callback);
  },

  /**
   * Clear all state (useful for testing or logout)
   */
  clear(): void {
    // Clear memory
    memoryStore.clear();

    // Clear persistent storage with our prefix
    for (const storageType of ['session', 'local'] as const) {
      const storage = getStorage(storageType);
      if (!storage) continue;

      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => storage.removeItem(k));
    }

    // Clear subscribers
    subscribers.clear();
  }
};
