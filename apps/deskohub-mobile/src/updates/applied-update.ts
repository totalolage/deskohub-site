import { Effect, Option } from "effect";
import { DeviceStorage } from "../customer-api/device-capabilities";

/** The update this launch runs, as `expo-updates` reports it. */
export interface RunningUpdate {
  /** `null` where `expo-updates` is disabled. */
  readonly updateId: string | null;
  readonly runtimeVersion: string | null;
  /** True for the update built into the APK, false for a downloaded one. */
  readonly isEmbeddedLaunch: boolean;
}

/** An over-the-air update the app has started running. */
export interface AppliedUpdate {
  readonly updateId: string;
  readonly runtimeVersion?: string;
}

/** The update the previous launch ran; not account data, so kept on exit. */
export const lastLaunchedUpdateKey = "deskohub.updates.last-launched-update-id";

/**
 * Records an applied update on the first launch that runs a downloaded
 * update, whether a restart from the update prompt or a cold start loaded
 * it. A launch of the embedded update records nothing: after a rollback,
 * an emergency launch or a new APK, the app runs the build's own update,
 * not a published one. Each launch stores the update it runs, the embedded
 * one included, so an update applied again after it counts again. Nothing
 * is recorded unless the launch was stored, so a storage failure can't
 * record the same update twice.
 */
export const recordAppliedUpdate = (
  running: RunningUpdate,
  record: (update: AppliedUpdate) => void
): Effect.Effect<void, never, DeviceStorage> => {
  const { updateId, runtimeVersion, isEmbeddedLaunch } = running;
  if (updateId === null) return Effect.void;
  return Effect.gen(function* () {
    const storage = yield* DeviceStorage;
    const previous = yield* storage.getItem(lastLaunchedUpdateKey);
    if (Option.contains(previous, updateId)) return;
    yield* storage.setItem(lastLaunchedUpdateKey, updateId);
    if (isEmbeddedLaunch) return;
    record({
      updateId,
      ...(runtimeVersion === null ? {} : { runtimeVersion }),
    });
  }).pipe(
    Effect.catchTag("DeviceCapabilityFailed", (failure) =>
      Effect.logWarning("Applied update check failed", failure)
    ),
    Effect.withSpan("Updates.recordAppliedUpdate")
  );
};
