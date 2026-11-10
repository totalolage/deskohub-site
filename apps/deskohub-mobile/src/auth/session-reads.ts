/** The part of Better Auth's session store state a read count needs. */
export interface SessionQueryState {
  readonly isPending: boolean;
  readonly isRefetching: boolean;
  readonly error: unknown;
}

interface SessionStore {
  readonly get: () => SessionQueryState;
  readonly listen: (listener: (state: SessionQueryState) => void) => unknown;
}

export interface SessionReads {
  /** How many session reads have completed since counting began. */
  readonly current: () => number;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Counts the session reads that complete, so a caller can tell whether a read
 * finished after a moment it recorded. A read that fails isn't counted; one
 * Better Auth cancels for a newer read never reaches the store.
 */
export const countSessionReads = (store: SessionStore): SessionReads => {
  let count = 0;
  let previous = store.get();
  const listeners = new Set<() => void>();
  store.listen((next) => {
    const completed =
      previous.isRefetching && !next.isRefetching && next.error == null;
    previous = next;
    if (!completed) return;
    count += 1;
    for (const listener of listeners) listener();
  });
  return {
    current: () => count,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
