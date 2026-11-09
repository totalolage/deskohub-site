import { Option } from "effect";

// Storage can be unavailable (privacy modes, quota, sandboxed frames): reads
// then come back empty and writes are dropped.
const readItem = Option.liftThrowable((key: string) =>
  globalThis.localStorage.getItem(key)
);
const writeItem = Option.liftThrowable((key: string, value: string | null) => {
  if (value === null) globalThis.localStorage.removeItem(key);
  else globalThis.localStorage.setItem(key, value);
});

/** Best-effort read of this browser's localStorage; null when absent or unavailable. */
export const readLocalStorageItem = (key: string): string | null =>
  Option.getOrNull(readItem(key)) ?? null;

/** Best-effort write to this browser's localStorage; null removes the item. */
export const writeLocalStorageItem = (
  key: string,
  value: string | null
): void => {
  writeItem(key, value);
};

const writeSignal = Option.liftThrowable((key: string) =>
  globalThis.localStorage.setItem(key, crypto.randomUUID())
);

/**
 * Best-effort nudge for this browser's other tabs: writes a fresh random nonce
 * under `key`, which fires their `storage` event. The value carries nothing.
 */
export const signalOtherTabs = (key: string): void => {
  writeSignal(key);
};

/** Calls `onSignal` whenever another tab runs `signalOtherTabs(key)`. */
export const subscribeOtherTabSignal = (
  key: string,
  onSignal: () => void
): (() => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === key) onSignal();
  };
  globalThis.addEventListener("storage", handleStorage);
  return () => globalThis.removeEventListener("storage", handleStorage);
};
