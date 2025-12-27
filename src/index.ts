import { state, StateOptions } from './state';
import { events, EventHandler } from './events';
import { meta, MetaStore } from './meta';
import { actions, ApiOptions, ApiResponse } from './actions';

export interface CC {
  state: typeof state;
  events: typeof events;
  meta: typeof meta;
  actions: typeof actions;
}

export const cc: CC = {
  state,
  events,
  meta,
  actions
};

// Auto-attach to window in browser environments
if (typeof window !== 'undefined') {
  (window as unknown as { cc: CC }).cc = cc;
}

// Named exports for ESM usage
export { state, events, meta, actions };
export type { StateOptions, EventHandler, MetaStore, ApiOptions, ApiResponse };

// Default export
export default cc;
