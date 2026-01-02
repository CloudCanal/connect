import PocketBase, { RecordModel, RecordSubscription } from 'pocketbase';
import { events, setDbModule } from './events';
import { state } from './state';

// Types
export interface DbUser extends RecordModel {
  email: string;
  username?: string;
  name?: string;
  avatar?: string;
}

export interface ListOptions {
  page?: number;
  perPage?: number;
  filter?: string;
  sort?: string;
  expand?: string;
  fields?: string;
}

export interface ListResult<T> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

// Internal state
let pb: PocketBase | null = null;
let dbUrl: string = typeof window !== 'undefined' ? window.location.origin : '';
let dbAutoCancellation: boolean = false;
const realtimeUnsubscribers = new Map<string, () => void>();
const realtimeRecordUnsubscribers = new Map<string, () => void>(); // Key: "collection:id"

/**
 * Get or create the PocketBase instance
 */
function getClient(): PocketBase {
  if (!pb) {
    pb = new PocketBase(dbUrl);

    // Disable auto-cancellation by default (can be overridden via db.autoCancellation)
    pb.autoCancellation(dbAutoCancellation);

    // Listen for auth changes
    pb.authStore.onChange(() => {
      saveAuthState();
      events.emit('auth:change', {
        user: pb?.authStore.record as DbUser | null,
        isAuthenticated: pb?.authStore.isValid ?? false
      });
    });

    // Restore auth from previous session
    restoreAuthState();
  }
  return pb;
}

/**
 * Save auth state to local storage
 */
function saveAuthState(): void {
  if (!pb) return;

  if (pb.authStore.isValid) {
    const user = pb.authStore.record as DbUser | null;
    state.set('_auth:token', pb.authStore.token, { persist: 'local' });
    state.set('_auth:user', user, { persist: 'local' });
  } else {
    state.remove('_auth:token');
    state.remove('_auth:user');
  }
}

/**
 * Restore auth state from local storage
 */
function restoreAuthState(): void {
  if (!pb) return;

  const token = state.get<string>('_auth:token');
  const user = state.get<DbUser>('_auth:user');

  if (token && user) {
    pb.authStore.save(token, user);
  }
}

/**
 * Enable realtime for a collection (called by events module)
 */
async function enableRealtime(collection: string): Promise<void> {
  if (realtimeUnsubscribers.has(collection)) return;

  const client = getClient();
  const unsubscribe = await client.collection(collection).subscribe('*', (e: RecordSubscription<RecordModel>) => {
    events.emit(`db:${collection}:${e.action}`, { record: e.record });
  });

  realtimeUnsubscribers.set(collection, unsubscribe);
}

/**
 * Disable realtime for a collection (called by events module)
 */
async function disableRealtime(collection: string): Promise<void> {
  const unsubscribe = realtimeUnsubscribers.get(collection);
  if (unsubscribe) {
    unsubscribe();
    realtimeUnsubscribers.delete(collection);
  }
}

/**
 * Enable realtime for a specific record (called by events module)
 */
async function enableRealtimeRecord(collection: string, id: string): Promise<void> {
  const key = `${collection}:${id}`;
  if (realtimeRecordUnsubscribers.has(key)) return;

  const client = getClient();
  const unsubscribe = await client.collection(collection).subscribe(id, (e: RecordSubscription<RecordModel>) => {
    events.emit(`db:${collection}:${e.action}:${id}`, { record: e.record });
  });

  realtimeRecordUnsubscribers.set(key, unsubscribe);
}

/**
 * Disable realtime for a specific record (called by events module)
 */
async function disableRealtimeRecord(collection: string, id: string): Promise<void> {
  const key = `${collection}:${id}`;
  const unsubscribe = realtimeRecordUnsubscribers.get(key);
  if (unsubscribe) {
    unsubscribe();
    realtimeRecordUnsubscribers.delete(key);
  }
}

// Register with events module
setDbModule({ enableRealtime, disableRealtime, enableRealtimeRecord, disableRealtimeRecord });

export const db = {
  /**
   * Get or set the PocketBase URL
   * Defaults to window.location.origin
   */
  get url(): string {
    return dbUrl;
  },

  set url(value: string) {
    dbUrl = value;
    // Reset client so it reconnects with new URL
    if (pb) {
      pb = null;
    }
  },

  /**
   * Get or set auto-cancellation behavior
   * Defaults to false (disabled)
   */
  get autoCancellation(): boolean {
    return dbAutoCancellation;
  },

  set autoCancellation(value: boolean) {
    dbAutoCancellation = value;
    // Apply to existing client if any
    if (pb) {
      pb.autoCancellation(value);
    }
  },

  /**
   * Get the underlying PocketBase instance for advanced usage
   */
  client(): PocketBase {
    return getClient();
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return getClient().authStore.isValid;
  },

  /**
   * Get current authenticated user
   */
  getUser<T extends DbUser = DbUser>(): T | null {
    return (getClient().authStore.record as T) ?? null;
  },

  // ==================== AUTH ====================

  /**
   * Sign up a new user
   */
  async signup(email: string, password: string, data: Record<string, unknown> = {}): Promise<DbUser> {
    const client = getClient();
    const user = await client.collection('users').create<DbUser>({
      email,
      password,
      passwordConfirm: password,
      ...data
    });
    events.emit('auth:signup', { user });
    return user;
  },

  /**
   * Log in with email and password
   */
  async login(email: string, password: string): Promise<DbUser> {
    const client = getClient();
    const auth = await client.collection('users').authWithPassword<DbUser>(email, password);
    events.emit('auth:login', { user: auth.record });
    return auth.record;
  },

  /**
   * Log in with OAuth2 provider
   */
  async loginWithOAuth(provider: string): Promise<DbUser> {
    const client = getClient();
    const auth = await client.collection('users').authWithOAuth2<DbUser>({ provider });
    events.emit('auth:login', { user: auth.record });
    return auth.record;
  },

  /**
   * Log out the current user
   */
  logout(): void {
    const user = this.getUser();
    const client = getClient();
    client.authStore.clear();
    state.remove('_auth:token');
    state.remove('_auth:user');
    events.emit('auth:logout', { user });
  },

  /**
   * Refresh the auth token
   */
  async refreshAuth(): Promise<DbUser> {
    const client = getClient();
    const auth = await client.collection('users').authRefresh<DbUser>();
    events.emit('auth:refresh', { user: auth.record });
    return auth.record;
  },

  /**
   * Request a password reset email
   */
  async resetPassword(email: string): Promise<void> {
    const client = getClient();
    await client.collection('users').requestPasswordReset(email);
    events.emit('auth:reset-request', { email });
  },

  /**
   * Confirm a password reset
   */
  async confirmResetPassword(token: string, password: string): Promise<void> {
    const client = getClient();
    await client.collection('users').confirmPasswordReset(token, password, password);
    events.emit('auth:reset-confirm', {});
  },

  /**
   * Request email verification
   */
  async requestVerification(email: string): Promise<void> {
    const client = getClient();
    await client.collection('users').requestVerification(email);
    events.emit('auth:verify-request', { email });
  },

  /**
   * Confirm email verification
   */
  async confirmVerification(token: string): Promise<void> {
    const client = getClient();
    await client.collection('users').confirmVerification(token);
    events.emit('auth:verify-confirm', {});
  },

  // ==================== CRUD ====================

  /**
   * Get a single record by ID
   */
  async get<T extends RecordModel = RecordModel>(
    collection: string,
    id: string,
    options: Omit<ListOptions, 'page' | 'perPage' | 'filter' | 'sort'> = {}
  ): Promise<T> {
    const client = getClient();
    return client.collection(collection).getOne<T>(id, options);
  },

  /**
   * List records with pagination
   */
  async list<T extends RecordModel = RecordModel>(
    collection: string,
    options: ListOptions = {}
  ): Promise<ListResult<T>> {
    const client = getClient();
    const { page = 1, perPage = 20, ...rest } = options;
    return client.collection(collection).getList<T>(page, perPage, rest);
  },

  /**
   * Get all records (auto-paginated)
   */
  async getAll<T extends RecordModel = RecordModel>(
    collection: string,
    options: Omit<ListOptions, 'page' | 'perPage'> = {}
  ): Promise<T[]> {
    const client = getClient();
    return client.collection(collection).getFullList<T>(options);
  },

  /**
   * Get the first record matching a filter
   */
  async getFirst<T extends RecordModel = RecordModel>(
    collection: string,
    filter: string,
    options: Omit<ListOptions, 'page' | 'perPage' | 'filter'> = {}
  ): Promise<T | null> {
    const client = getClient();
    try {
      return await client.collection(collection).getFirstListItem<T>(filter, options);
    } catch {
      return null;
    }
  },

  /**
   * Create a new record
   * Data can be a plain object or FormData (for file uploads)
   */
  async create<T extends RecordModel = RecordModel>(
    collection: string,
    data: Record<string, unknown> | FormData,
    options: Omit<ListOptions, 'page' | 'perPage' | 'filter' | 'sort'> = {}
  ): Promise<T> {
    const client = getClient();
    const record = await client.collection(collection).create<T>(data, options);
    events.emit(`db:${collection}:create`, { record });
    return record;
  },

  /**
   * Update an existing record
   * Data can be a plain object or FormData (for file uploads)
   */
  async update<T extends RecordModel = RecordModel>(
    collection: string,
    id: string,
    data: Record<string, unknown> | FormData,
    options: Omit<ListOptions, 'page' | 'perPage' | 'filter' | 'sort'> = {}
  ): Promise<T> {
    const client = getClient();
    const record = await client.collection(collection).update<T>(id, data, options);
    events.emit(`db:${collection}:update`, { record });
    return record;
  },

  /**
   * Delete a record
   */
  async delete(collection: string, id: string): Promise<void> {
    const client = getClient();
    await client.collection(collection).delete(id);
    events.emit(`db:${collection}:delete`, { id });
  },

  // ==================== FILES ====================

  /**
   * Get a file URL from a record
   */
  getFileUrl(
    record: RecordModel,
    filename: string,
    options: { thumb?: string } = {}
  ): string {
    const client = getClient();
    return client.files.getURL(record, filename, options);
  }
};
