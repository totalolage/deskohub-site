import { Clock, Effect, identity } from "effect";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";

/**
 * The test environment's key ring, the one `SealedStateKeys.Default` reads,
 * built synchronously so `Effect.runSync` can provide it. State sealed under
 * it opens in code that provides `SealedStateKeys.Default`, and back.
 */
export const TestSealedStateKeys = SealedStateKeys.fromConfiguration(
  process.env.CHECKOUT_PAY_STATE_KEYS ?? ""
);

/** A configured key ring of synthetic keys, each 32 bytes of `fill`. */
export const syntheticSealedStateKeyRing = (
  ...keys: ReadonlyArray<readonly [kid: string, fill: number]>
) =>
  keys
    .map(
      ([kid, fill]) => `${kid}:${Buffer.alloc(32, fill).toString("base64url")}`
    )
    .join(",");

/**
 * Runs sealed state work synchronously under the configured key ring `keys`
 * (the test environment's by default) and, given `at`, on a clock stopped at
 * that moment.
 */
export const runSealedState = <A, E>(
  effect: Effect.Effect<A, E, SealedStateKeys>,
  options: { readonly keys?: string; readonly at?: Date } = {}
) => {
  const keys =
    options.keys === undefined
      ? TestSealedStateKeys
      : SealedStateKeys.fromConfiguration(options.keys);
  const at = options.at;

  return Effect.runSync(
    effect.pipe(
      at === undefined ? identity : stopClockAt(at),
      Effect.provide(keys)
    )
  );
};

const stopClockAt =
  (at: Date) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Clock.clockWith((clock) =>
      effect.pipe(
        Effect.provideService(Clock.Clock, {
          currentTimeMillisUnsafe: () => at.getTime(),
          currentTimeMillis: Effect.succeed(at.getTime()),
          currentTimeNanosUnsafe: () => BigInt(at.getTime()) * 1_000_000n,
          currentTimeNanos: Effect.succeed(BigInt(at.getTime()) * 1_000_000n),
          sleep: (duration) => clock.sleep(duration),
        })
      )
    );
