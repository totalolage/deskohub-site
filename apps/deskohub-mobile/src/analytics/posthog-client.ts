import AsyncStorage from "@react-native-async-storage/async-storage";
import PostHog, { PostHogPersistedProperty } from "posthog-react-native";
import type { CreateAnalyticsClient } from "./analytics-client";
import { failedFlagReload, type StoredFlagResponse } from "./flag-reload";

/**
 * A PostHog client that can be retired: once retired it sends nothing, and
 * once its cleared storage is saved it writes nothing more. The SDK keeps an
 * AppState listener and pending flag requests alive after shutdown, and
 * saves its whole storage blob on each write, so a retired client could
 * otherwise send late requests or overwrite a newer client's storage.
 */
class RetirablePostHog extends PostHog {
  networkRetired = false;

  override fetch(
    ...[url, options]: Parameters<PostHog["fetch"]>
  ): ReturnType<PostHog["fetch"]> {
    if (this.networkRetired) {
      return Promise.reject(new Error("Analytics was withdrawn."));
    }
    return super.fetch(url, options);
  }
}

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
  let storageRetired = false;
  const posthog = new RetirablePostHog(apiKey, {
    host,
    // AsyncStorage on every platform, so no expo-file-system is needed.
    persistence: "file",
    customStorage: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) =>
        storageRetired ? undefined : AsyncStorage.setItem(key, value),
    },
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
    // The SDK loads its stored identity asynchronously.
    ready: () => posthog.ready(),
    identifiedAs: () => {
      const distinctId = posthog.getDistinctId();
      return distinctId !== posthog.getAnonymousId() ? distinctId : null;
    },
    capture: (event, properties) => posthog.capture(event, properties),
    screen: (name) => void posthog.screen(name),
    identify: (distinctId) => posthog.identify(distinctId),
    setPersonProperties: (properties) =>
      posthog.setPersonProperties(properties),
    reset: () => {
      posthog.reset();
      // reset() clears registered properties too.
      void posthog.register(superProperties);
    },
    // The SDK queues a reload behind one already in flight, so the promise
    // settles with flags requested after the call. It stores the response's
    // outcome before resolving.
    reloadFeatureFlags: async () => {
      const flags = await posthog.reloadFeatureFlagsAsync();
      const failure = failedFlagReload(
        flags,
        posthog.getPersistedProperty<StoredFlagResponse>(
          PostHogPersistedProperty.FeatureFlagDetails
        )
      );
      if (failure !== undefined) throw new Error(failure);
    },
    getFeatureFlag: (flag) => posthog.getFeatureFlag(flag),
    onFeatureFlags: (listener) => posthog.onFeatureFlags(() => listener()),
    shutDown: async () => {
      // Flushes ignore the opt-out, so stop sending at once, before any
      // await. Once the stored state has loaded, so it cannot restore what
      // is cleared, clear every stored property, the event queue and identity
      // included, record the opt-out, and let shutdown save the cleared
      // storage before fencing it. A request already in flight cannot be
      // recalled.
      posthog.networkRetired = true;
      try {
        await posthog.ready();
        for (const key of Object.values(PostHogPersistedProperty)) {
          posthog.setPersistedProperty(key, null);
        }
        posthog.setPersistedProperty(PostHogPersistedProperty.OptedOut, true);
        await posthog.shutdown();
      } finally {
        storageRetired = true;
      }
    },
  };
};
