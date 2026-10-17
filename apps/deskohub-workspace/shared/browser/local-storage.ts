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
