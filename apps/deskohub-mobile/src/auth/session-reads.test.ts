import { describe, expect, test } from "bun:test";
import { countSessionReads, type SessionQueryState } from "./session-reads";

const idle: SessionQueryState = {
  isPending: false,
  isRefetching: false,
  error: null,
};

/** The part of a nanostores atom the counter uses. */
const storeAt = (initial: SessionQueryState) => {
  let value = initial;
  const listeners = new Set<(next: SessionQueryState) => void>();
  return {
    get: () => value,
    listen: (listener: (next: SessionQueryState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next: SessionQueryState) => {
      value = next;
      for (const listener of listeners) listener(next);
    },
  };
};

describe("countSessionReads", () => {
  test("counts each read that completes", () => {
    const store = storeAt({
      isPending: true,
      isRefetching: false,
      error: null,
    });
    const reads = countSessionReads(store);
    expect(reads.current()).toBe(0);

    store.set({ isPending: true, isRefetching: true, error: null });
    store.set(idle);
    expect(reads.current()).toBe(1);

    store.set({ ...idle, isRefetching: true });
    store.set(idle);
    expect(reads.current()).toBe(2);
  });

  test("doesn't count a read that fails", () => {
    const store = storeAt(idle);
    const reads = countSessionReads(store);
    store.set({ ...idle, isRefetching: true });
    store.set({ ...idle, error: new Error("offline") });
    expect(reads.current()).toBe(0);
  });

  test("tells subscribers when a read completes", () => {
    const store = storeAt(idle);
    const reads = countSessionReads(store);
    let notified = 0;
    const stop = reads.subscribe(() => {
      notified += 1;
    });
    store.set({ ...idle, isRefetching: true });
    store.set(idle);
    stop();
    store.set({ ...idle, isRefetching: true });
    store.set(idle);
    expect(notified).toBe(1);
    expect(reads.current()).toBe(2);
  });
});
