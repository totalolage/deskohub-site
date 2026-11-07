import { Effect, Layer, Option } from "effect";
import { AccountScopedStorage } from "../customer-api/account-scoped-storage";
import { DeviceCapabilityFailed } from "../customer-api/device-capabilities";

/**
 * One account's storage kept in `entries` by entry name, which a test reads
 * and seeds. The real `AccountScopedStorage` adds the origin and account to
 * each name; this one keeps the bare name.
 */
export const inMemoryAccountScopedStorage = (
  entries: Map<string, string>
): Layer.Layer<AccountScopedStorage> =>
  Layer.succeed(AccountScopedStorage, {
    getItem: (name) =>
      Effect.sync(() => Option.fromUndefinedOr(entries.get(name))),
    setItem: (name, value) => Effect.sync(() => void entries.set(name, value)),
    removeItem: (name) => Effect.sync(() => void entries.delete(name)),
    writeTemporaryFile: () => Effect.succeed(Option.none()),
  });

/** Account storage whose every read and write fails, as a broken disk does. */
export const failingAccountScopedStorage: Layer.Layer<AccountScopedStorage> =
  Layer.succeed(AccountScopedStorage, {
    getItem: () =>
      Effect.fail(new DeviceCapabilityFailed({ capability: "storage" })),
    setItem: () =>
      Effect.fail(new DeviceCapabilityFailed({ capability: "storage" })),
    removeItem: () =>
      Effect.fail(new DeviceCapabilityFailed({ capability: "storage" })),
    writeTemporaryFile: () =>
      Effect.fail(
        new DeviceCapabilityFailed({ capability: "temporary-files" })
      ),
  });
