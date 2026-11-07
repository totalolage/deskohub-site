import { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { findNativeUpdate, type NativeUpdateOffer } from "./native-release";
import { findReadyUpdate, type OtaUpdateSource } from "./ota-update";

/**
 * The app checks on launch and whenever it returns to the foreground, at most
 * once per interval, so switching apps back and forth doesn't poll the server.
 */
export const updateCheckIntervalMs = 15 * 60 * 1000;

export const isUpdateCheckDue = (
  lastCheckStartedAt: number | undefined,
  now: number
): boolean =>
  lastCheckStartedAt === undefined ||
  now < lastCheckStartedAt ||
  now - lastCheckStartedAt >= updateCheckIntervalMs;

export type UpdateCheckPlan = {
  readonly otaUpdate: boolean;
  readonly nativeRelease: boolean;
};

/**
 * Which checks apply. Web is served fresh by the Workspace. Only Android
 * installs APKs, so iOS checks only for JS updates. `otaUpdatesEnabled` is
 * `Updates.isEnabled`, false when the build disables or misconfigures
 * expo-updates.
 */
export const planUpdateCheck = ({
  platform,
  otaUpdatesEnabled,
}: {
  readonly platform: string;
  readonly otaUpdatesEnabled: boolean;
}): UpdateCheckPlan => ({
  otaUpdate: platform !== "web" && otaUpdatesEnabled,
  nativeRelease: platform === "android",
});

export type UpdateCheckOutcome = {
  readonly readyUpdateId: string | undefined;
  readonly nativeUpdate: NativeUpdateOffer | undefined;
};

/** Runs the planned checks side by side; neither can fail the other. */
export const runUpdateCheck = ({
  plan,
  updates,
  installedBuildVersion,
  latestReleaseUrl,
}: {
  readonly plan: UpdateCheckPlan;
  readonly updates: OtaUpdateSource;
  readonly installedBuildVersion: string | null;
  readonly latestReleaseUrl: string;
}): Effect.Effect<UpdateCheckOutcome, never, HttpClient.HttpClient> =>
  Effect.all(
    {
      readyUpdateId: plan.otaUpdate
        ? findReadyUpdate(updates)
        : Effect.undefined,
      nativeUpdate: plan.nativeRelease
        ? findNativeUpdate({ installedBuildVersion, latestReleaseUrl })
        : Effect.undefined,
    },
    { concurrency: "unbounded" }
  );
