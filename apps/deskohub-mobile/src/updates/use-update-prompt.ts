import { Effect } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/unstable/http";
import { nativeBuildVersion } from "expo-application";
import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import type { NativeUpdateOffer } from "./native-release";
import {
  isUpdateCheckDue,
  planUpdateCheck,
  runUpdateCheck,
  type UpdateCheckOutcome,
} from "./update-check";
import {
  dismissUpdatePrompt,
  noUpdatePromptDismissals,
  selectUpdatePrompt,
  type UpdatePrompt,
} from "./update-prompt";
import { configuredWorkspaceUpdateUrls } from "./workspace-update-urls";

// The app's one runtime edge for update work: every Effect here runs in the
// background, and none reports a failure to the visitor.
const runInBackground = (
  effect: Effect.Effect<unknown, unknown, HttpClient.HttpClient>
): void => {
  Effect.runFork(
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Update prompt work failed", cause)
      ),
      Effect.provide(FetchHttpClient.layer)
    )
  );
};

const openNativeDownload = Effect.tryPromise(() =>
  Linking.openURL(configuredWorkspaceUpdateUrls.androidDownloadUrl)
);

const restartIntoUpdate = Effect.tryPromise(() => Updates.reloadAsync());

/**
 * Checks for a downloaded JS update and a newer APK on launch and on each
 * return to the foreground, and returns the one prompt to show. Accepting
 * restarts into the downloaded update or opens the `/android` download page;
 * dismissing hides that offer for the rest of the session.
 */
export function useUpdatePrompt(): {
  readonly prompt: UpdatePrompt | undefined;
  readonly accept: () => void;
  readonly dismiss: () => void;
} {
  const [readyUpdateId, setReadyUpdateId] = useState<string>();
  const [nativeUpdate, setNativeUpdate] = useState<NativeUpdateOffer>();
  const [dismissals, setDismissals] = useState(noUpdatePromptDismissals);
  const lastCheckStartedAt = useRef<number>(undefined);

  useEffect(() => {
    // Debug and dev-client builds load JS from Metro: expo-updates is
    // disabled there or rejects every check, so they skip the JS update.
    const plan = planUpdateCheck({
      platform: Platform.OS,
      otaUpdatesEnabled: Updates.isEnabled && !__DEV__,
    });
    if (!(plan.otaUpdate || plan.nativeRelease)) {
      return;
    }
    // A failed or empty check keeps what an earlier check found: the
    // installed build can't change while the app runs, and a downloaded
    // update stays ready until the restart.
    const apply = (outcome: UpdateCheckOutcome) => {
      if (outcome.readyUpdateId !== undefined) {
        setReadyUpdateId(outcome.readyUpdateId);
      }
      if (outcome.nativeUpdate !== undefined) {
        setNativeUpdate(outcome.nativeUpdate);
      }
    };
    const checkIfDue = () => {
      const now = Date.now();
      if (!isUpdateCheckDue(lastCheckStartedAt.current, now)) {
        return;
      }
      lastCheckStartedAt.current = now;
      runInBackground(
        runUpdateCheck({
          plan,
          updates: Updates,
          installedBuildVersion: nativeBuildVersion,
          latestReleaseUrl: configuredWorkspaceUpdateUrls.latestReleaseUrl,
        }).pipe(Effect.tap((outcome) => Effect.sync(() => apply(outcome))))
      );
    };
    checkIfDue();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        checkIfDue();
      }
    });
    return () => subscription.remove();
  }, []);

  const prompt = selectUpdatePrompt({
    nativeUpdate,
    readyUpdateId,
    dismissals,
  });

  return {
    prompt,
    accept: () => {
      if (prompt === undefined) {
        return;
      }
      runInBackground(
        prompt.kind === "native-release"
          ? openNativeDownload
          : restartIntoUpdate
      );
    },
    dismiss: () => {
      if (prompt !== undefined) {
        setDismissals((current) => dismissUpdatePrompt(current, prompt));
      }
    },
  };
}
