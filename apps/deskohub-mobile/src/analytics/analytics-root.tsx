import { useSegments } from "expo-router";
import { type ReactNode, useEffect } from "react";
import { Platform } from "react-native";
import { useAuthSession } from "../auth/use-auth-session";
import { ConsentPrompt } from "../consent/consent-prompt";
import {
  appAnalyticsConsent,
  useAnalyticsConsent,
} from "../consent/use-analytics-consent";
import { analytics, setAnalyticsIdentity } from "./analytics";
import {
  classifyDeploymentEnvironment,
  resolveAnalyticsSettings,
} from "./analytics-settings";
import { trackScreenView } from "./events";
import { detectOtherPostHogSdk } from "./other-posthog-sdk";
import { createPostHogClient } from "./posthog-client";
import { screenPathPattern } from "./screen-path";
import { analyticsIdentityOf } from "./session-identity";

const webHostname = () =>
  Platform.OS === "web" ? window.location.hostname : undefined;

const connectAnalytics = () =>
  analytics.connect({
    settings: resolveAnalyticsSettings({
      apiKey: process.env.EXPO_PUBLIC_POSTHOG_KEY,
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
      appHostname: webHostname(),
      environment: classifyDeploymentEnvironment({
        hostname: webHostname(),
        isDevelopmentBuild: __DEV__,
      }),
    }),
    createClient: createPostHogClient,
    detectOtherSdk: () =>
      Platform.OS === "web" && detectOtherPostHogSdk(window),
    consent: appAnalyticsConsent(),
    warn: (message) => console.warn(message),
  });

/**
 * Attributes analytics to the signed-in account
 * (`workspace-account:<accountId>`), and to no one once signed out. Holds
 * while the stored session is restored.
 */
const useSessionAnalyticsIdentity = () => {
  const identity = analyticsIdentityOf(useAuthSession());
  // Effects key on the identity's parts: each session refetch is a new object.
  const { kind } = identity;
  const accountId =
    identity.kind === "authenticated" ? identity.accountId : undefined;
  const testAccount = identity.kind === "authenticated" && identity.testAccount;
  useEffect(() => {
    if (accountId !== undefined) {
      setAnalyticsIdentity({ kind: "authenticated", accountId, testAccount });
    } else if (kind !== "authenticated") {
      setAnalyticsIdentity({ kind });
    }
  }, [kind, accountId, testAccount]);
};

/**
 * Connects analytics for the app's lifetime, records screen views and asks
 * for analytics consent while there is no answer.
 */
export function AnalyticsRoot({ children }: { readonly children: ReactNode }) {
  const consent = useAnalyticsConsent();
  // The route pattern (`/reservations/[orderId]`), never the concrete path.
  const screen = screenPathPattern(useSegments());
  // Screen views wait in memory while the answer loads; a later grant records
  // the current screen again, since it was dropped while undecided.
  const recording =
    consent.status === "granted" || consent.status === "loading";

  useEffect(connectAnalytics, []);
  useSessionAnalyticsIdentity();
  useEffect(() => {
    if (recording) trackScreenView(screen);
  }, [screen, recording]);

  return (
    <>
      {children}
      {consent.status === "undecided" && (
        <ConsentPrompt onAccept={consent.grant} onDecline={consent.deny} />
      )}
    </>
  );
}
