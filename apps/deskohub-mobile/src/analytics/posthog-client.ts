import AsyncStorage from "@react-native-async-storage/async-storage";
import PostHog, { PostHogPersistedProperty } from "posthog-react-native";
import type { CreateAnalyticsClient } from "./analytics-client";

/**
 * Builds the posthog-react-native client. Only the analytics controller calls
 * this, after consent is granted, because construction already fetches remote
 * config. Automatic capture, surveys, session replay and exception capture
 * stay off; Expo Router screens are recorded manually.
 */
export const createPostHogClient: CreateAnalyticsClient = ({
  apiKey,
  host,
  superProperties,
}) => {
  const posthog = new PostHog(apiKey, {
    host,
    // AsyncStorage on every platform, so no expo-file-system is needed.
    persistence: "file",
    customStorage: AsyncStorage,
    personProfiles: "identified_only",
    captureAppLifecycleEvents: false,
    disableSurveys: true,
    enableSessionReplay: false,
    errorTracking: { autocapture: false },
    // The controller loads flags once the identity is settled.
    preloadFeatureFlags: false,
  });
  // A withdrawal persists the opt-out; this client exists only with consent.
  void posthog.optIn();
  void posthog.register(superProperties);

  return {
    capture: (event, properties) => posthog.capture(event, properties),
    screen: (name) => void posthog.screen(name),
    identify: (distinctId) => posthog.identify(distinctId),
    setPersonProperties: (properties) =>
      posthog.setPersonProperties(properties),
    reset: () => posthog.reset(),
    reloadFeatureFlags: () => posthog.reloadFeatureFlags(),
    getFeatureFlag: (flag) => posthog.getFeatureFlag(flag),
    onFeatureFlags: (listener) => posthog.onFeatureFlags(() => listener()),
    shutDown: async () => {
      // optOut() blocks new events but leaves queued ones sendable, reset()
      // keeps the queue and reloads flags, and flush() ignores the opt-out.
      // So clear every stored property, the event queue and identity
      // included, then shut down: its final flush finds nothing to send and
      // it persists the cleared storage. A request already in flight cannot
      // be recalled. Waiting for ready() first keeps the storage preload from
      // restoring what is cleared here.
      await posthog.ready();
      await posthog.optOut();
      for (const key of Object.values(PostHogPersistedProperty)) {
        if (key !== PostHogPersistedProperty.OptedOut) {
          posthog.setPersistedProperty(key, null);
        }
      }
      await posthog.shutdown();
    },
  };
};
