import { state, StateOptions } from './state';
import { events, EventCallback } from './events';
import { db, DbUser, ListOptions, ListResult } from './db';

export interface CC {
  state: typeof state;
  events: typeof events;
  db: typeof db;
}

export const cc: CC = {
  state,
  events,
  db
};

// Auto-attach to window in browser environments
if (typeof window !== 'undefined') {
  (window as unknown as { cc: CC }).cc = cc;
}

// Named exports for ESM usage
export { state, events, db };
export type { StateOptions, EventCallback, DbUser, ListOptions, ListResult };

// Default export
export default cc;
