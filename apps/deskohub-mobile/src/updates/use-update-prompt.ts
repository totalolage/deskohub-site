import { Effect } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/unstable/http";
import { nativeBuildVersion } from "expo-application";
import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { trackUpdateApplied } from "../analytics/events";
import { deviceCapabilitiesLayer } from "../customer-api/device-capabilities-layer";
import { recordAppliedUpdate } from "./applied-update";
import { type NativeUpdateOffer, nextNativeUpdate } from "./native-release";
import type { ReadyUpdate } from "./ota-update";
import {
  isUpdateCheckDue,
  planUpdateCheck,
  runUpdateCheck,
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
 * Records an update this launch applied, then checks for a downloaded JS
 * update, a rollback and a newer APK on launch and on each return to the
 * foreground, and returns the one prompt to show. Accepting restarts into
 * the downloaded or embedded update, or opens the `/android` download page;
 * dismissing hides that offer for the rest of the session.
 */
export function useUpdatePrompt(): {
  readonly prompt: UpdatePrompt | undefined;
  readonly accept: () => void;
  readonly dismiss: () => void;
} {
  const [readyUpdate, setReadyUpdate] = useState<ReadyUpdate>();
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
    if (plan.otaUpdate) {
      runInBackground(
        recordAppliedUpdate(Updates, trackUpdateApplied).pipe(
          Effect.provide(deviceCapabilitiesLayer)
        )
      );
    }
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
          // A downloaded update or rollback stays ready until the restart,
          // so a later empty or failed check keeps it, and a newer one
          // replaces it: the next start launches only the newest.
          onReadyUpdate: (update) => {
            if (update !== undefined) {
              setReadyUpdate(update);
            }
          },
          onNativeRelease: (check) =>
            setNativeUpdate((previous) => nextNativeUpdate(previous, check)),
        })
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
    readyUpdate,
    runsEmbeddedUpdate: Updates.isEmbeddedLaunch,
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
