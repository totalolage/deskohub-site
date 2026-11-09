import { Option } from "effect";

// Storage can be unavailable (privacy modes, quota, sandboxed frames): reads
// then come back empty and writes are dropped.
const readItem = Option.liftThrowable((key: string) =>
  globalThis.sessionStorage.getItem(key)
);
const writeItem = Option.liftThrowable((key: string, value: string | null) => {
  if (value === null) globalThis.sessionStorage.removeItem(key);
  else globalThis.sessionStorage.setItem(key, value);
});

/** Best-effort read of this tab's sessionStorage; null when absent or unavailable. */
export const readSessionStorageItem = (key: string): string | null =>
  Option.getOrNull(readItem(key)) ?? null;

/** Best-effort write to this tab's sessionStorage; null removes the item. */
export const writeSessionStorageItem = (
  key: string,
  value: string | null
): void => {
  writeItem(key, value);
};
