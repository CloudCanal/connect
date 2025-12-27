export interface MetaStore {
  env: string;
  page: Record<string, unknown>;
  site: Record<string, unknown>;
  features: Record<string, boolean>;
  [key: string]: unknown;
}

let metaData: MetaStore = {
  env: 'production',
  page: {},
  site: {},
  features: {}
};

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current: unknown, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export const meta = {
  /**
   * Initialize meta data (typically called once at app startup)
   */
  init(data: Partial<MetaStore>): void {
    metaData = { ...metaData, ...data };
  },

  /**
   * Get meta value by key (supports dot notation for nested values)
   * @example meta.get('env') // 'production'
   * @example meta.get('page.title') // 'Home'
   * @example meta.get('features.beta') // true
   */
  get<T = unknown>(key: string): T | undefined {
    // Check for top-level key first
    if (key in metaData && !key.includes('.')) {
      return metaData[key] as T;
    }
    // Support dot notation
    return getNestedValue(metaData, key) as T | undefined;
  },

  /**
   * Check if a meta key exists and is truthy
   * Useful for feature flags: meta.has('features.beta')
   */
  has(key: string): boolean {
    const value = this.get(key);
    return value !== undefined && value !== null && value !== false;
  },

  /**
   * Set a meta value at runtime
   */
  set(key: string, value: unknown): void {
    if (!key.includes('.')) {
      metaData[key] = value;
      return;
    }

    // Handle nested keys
    const parts = key.split('.');
    const lastKey = parts.pop()!;
    let current: Record<string, unknown> = metaData;

    for (const part of parts) {
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[lastKey] = value;
  },

  /**
   * Get all meta data (for debugging)
   */
  getAll(): MetaStore {
    return { ...metaData };
  }
};
