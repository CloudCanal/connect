import { events } from './events';

// Types
export interface StateOptions {
  persist?: 'session' | 'local';
  ttl?: number; // Time to live in milliseconds
}

interface StoredValue {
  value: unknown;
  expiry?: number;
}

// Constants
const STORAGE_PREFIX = 'cc:';

// In-memory store for non-persisted values
const memoryStore = new Map<string, StoredValue>();

/**
 * Get the appropriate storage backend
 */
function getStorage(persist?: 'session' | 'local'): Storage | null {
  if (typeof window === 'undefined') return null;

  switch (persist) {
    case 'session':
      return sessionStorage;
    case 'local':
      return localStorage;
    default:
      return null;
  }
}

/**
 * Check if a stored value has expired
 */
function isExpired(stored: StoredValue): boolean {
  return stored.expiry !== undefined && Date.now() > stored.expiry;
}

/**
 * Get a value from storage
 */
function getFromStorage(key: string, storage: Storage): StoredValue | null {
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as StoredValue;
  } catch {
    return null;
  }
}

/**
 * Save a value to storage
 */
function saveToStorage(key: string, stored: StoredValue, storage: Storage): void {
  try {
    storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(stored));
  } catch (e) {
    console.error(`Failed to save to storage: ${key}`, e);
  }
}

/**
 * Remove a value from storage
 */
function removeFromStorage(key: string, storage: Storage): void {
  storage.removeItem(`${STORAGE_PREFIX}${key}`);
}

export const state = {
  /**
   * Get a value from state
   * Checks memory first, then session storage, then local storage
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

    // Check persistent stores
    for (const persist of ['session', 'local'] as const) {
      const storage = getStorage(persist);
      if (!storage) continue;

      const stored = getFromStorage(key, storage);
      if (stored) {
        if (isExpired(stored)) {
          removeFromStorage(key, storage);
          continue;
        }
        return stored.value as T;
      }
    }

    return undefined;
  },

  /**
   * Set a value in state
   * Emits 'state:{key}' event with { value, oldValue }
   */
  set(key: string, value: unknown, options: StateOptions = {}): void {
    const { persist, ttl } = options;
    const oldValue = this.get(key);

    const stored: StoredValue = {
      value,
      expiry: ttl ? Date.now() + ttl : undefined
    };

    const storage = getStorage(persist);
    if (storage) {
      saveToStorage(key, stored, storage);
      // Also remove from memory if it was there
      memoryStore.delete(key);
    } else {
      memoryStore.set(key, stored);
    }

    // Emit state change event
    events.emit(`state:${key}`, { value, oldValue });
  },

  /**
   * Check if a key exists in state
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  },

  /**
   * Delete a key from state
   * Emits 'state:{key}' event with { value: undefined, oldValue }
   */
  delete(key: string): void {
    const oldValue = this.get(key);
    if (oldValue === undefined) return;

    // Remove from memory
    memoryStore.delete(key);

    // Remove from all persistent stores
    for (const persist of ['session', 'local'] as const) {
      const storage = getStorage(persist);
      if (storage) {
        removeFromStorage(key, storage);
      }
    }

    // Emit state change event
    events.emit(`state:${key}`, { value: undefined, oldValue });
  },

  /**
   * Clear all state
   * Does NOT emit events for each key
   */
  clear(): void {
    // Clear memory
    memoryStore.clear();

    // Clear persistent storage with our prefix
    for (const persist of ['session', 'local'] as const) {
      const storage = getStorage(persist);
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
  }
};
