import { Effect } from "effect";
import type * as Updates from "expo-updates";

/** The part of `expo-updates` the foreground check uses. */
export type OtaUpdateSource = Pick<
  typeof Updates,
  "checkForUpdateAsync" | "fetchUpdateAsync"
>;

/**
 * Asks the update server for a JS update and downloads it. Resolves the
 * downloaded update's ID once a new one is ready to apply on restart, and
 * `undefined` otherwise. An offline device, a rejected signature or a
 * disabled updates module only skips this check.
 */
export const findReadyUpdate = (
  updates: OtaUpdateSource
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const check = yield* Effect.tryPromise(() => updates.checkForUpdateAsync());
    if (!check.isAvailable) {
      return undefined;
    }
    const fetched = yield* Effect.tryPromise(() => updates.fetchUpdateAsync());
    return fetched.isNew ? fetched.manifest.id : undefined;
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Over-the-air update check failed", error).pipe(
        Effect.as(undefined)
      )
    )
  );
