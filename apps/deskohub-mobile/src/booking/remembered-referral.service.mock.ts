import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect";
import { AccountScopedStorage } from "../customer-api/account-scoped-storage";
import { DeviceCapabilityFailed } from "../customer-api/device-capabilities";
import type { RememberedReferralUpdate } from "./remembered-referral";
import { RememberedReferralCode } from "./remembered-referral.service";

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
    temporaryFile: () => Effect.succeed(Option.none()),
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
    temporaryFile: () =>
      Effect.fail(
        new DeviceCapabilityFailed({ capability: "temporary-files" })
      ),
  });

/**
 * The real remembered referral code, recording each update it finished
 * applying, so a test waits for the write a flow runs on its own fiber
 * instead of guessing how long it takes.
 */
export const observedRememberedReferralCode = () => {
  const applied = Effect.runSync(
    SubscriptionRef.make<ReadonlyArray<RememberedReferralUpdate>>([])
  );
  return {
    layer: Layer.effect(
      RememberedReferralCode,
      Effect.map(Effect.service(RememberedReferralCode), (remembered) =>
        RememberedReferralCode.of({
          ...remembered,
          apply: (update) =>
            remembered
              .apply(update)
              .pipe(
                Effect.andThen(
                  SubscriptionRef.update(applied, (done) => [...done, update])
                )
              ),
        })
      )
    ).pipe(Layer.provide(RememberedReferralCode.Default)),
    /** Resolves once an update that `matches` has been applied. */
    untilApplied: (matches: (update: RememberedReferralUpdate) => boolean) =>
      Effect.runPromise(
        SubscriptionRef.changes(applied).pipe(
          Stream.filter((done) => done.some(matches)),
          Stream.runHead,
          Effect.asVoid
        )
      ),
  };
};
