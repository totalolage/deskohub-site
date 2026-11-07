import { usePathname } from "expo-router";
import { type ReactNode, useEffect } from "react";
import { Platform } from "react-native";
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
 * There is no sign-in yet, so every session is anonymous. The account
 * sign-in flow replaces this with `setAnalyticsIdentity` calls.
 */
const settleIdentityUntilSignInExists = () =>
  setAnalyticsIdentity({ kind: "anonymous" });

/**
 * Connects analytics for the app's lifetime, records screen views and asks
 * for analytics consent while there is no answer.
 */
export function AnalyticsRoot({ children }: { readonly children: ReactNode }) {
  const consent = useAnalyticsConsent();
  const pathname = usePathname();
  // Screen views wait in memory while the answer loads; a later grant records
  // the current screen again, since it was dropped while undecided.
  const recording =
    consent.status === "granted" || consent.status === "loading";

  useEffect(connectAnalytics, []);
  useEffect(settleIdentityUntilSignInExists, []);
  useEffect(() => {
    if (recording) trackScreenView(pathname);
  }, [pathname, recording]);

  return (
    <>
      {children}
      {consent.status === "undecided" && (
        <ConsentPrompt onAccept={consent.grant} onDecline={consent.deny} />
      )}
    </>
  );
}
