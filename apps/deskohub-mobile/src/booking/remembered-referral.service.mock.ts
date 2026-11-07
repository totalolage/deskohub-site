import { Effect, Layer, Option } from "effect";
import { RememberedReferralStorage } from "./remembered-referral.service";

/** Device storage kept in `entries`, which a test reads and seeds. */
export const inMemoryRememberedReferralStorage = (
  entries: Map<string, string>
): Layer.Layer<RememberedReferralStorage> =>
  Layer.succeed(RememberedReferralStorage, {
    getItem: (key) =>
      Effect.sync(() => Option.fromUndefinedOr(entries.get(key))),
    setItem: (key, value) => Effect.sync(() => void entries.set(key, value)),
    removeItem: (key) => Effect.sync(() => void entries.delete(key)),
  });
