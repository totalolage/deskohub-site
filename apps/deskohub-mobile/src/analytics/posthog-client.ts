import AsyncStorage from "@react-native-async-storage/async-storage";
import PostHog, { PostHogPersistedProperty } from "posthog-react-native";
import type { CreateAnalyticsClient } from "./analytics-client";
import { failedFlagReload, type StoredFlagResponse } from "./flag-reload";

/**
 * The AsyncStorage keys posthog-react-native 4.83.0 keeps all its state in
 * with `persistence: "file"` (`EVENTS_STORAGE_FILE` and `LOGS_STORAGE_FILE`
 * in its `storage.ts`): identity, super properties, flags and queued events.
 * Recheck them when upgrading the SDK.
 */
const postHogStorageKeys = [".posthog-rn.json", ".posthog-rn-logs.json"];

/**
 * Removes what earlier PostHog clients stored, so a withdrawn identity or
 * queued event can't come back with the next client. Only while no client
 * runs: a live client would write its copy back.
 */
export const clearPostHogStoredState = (): Promise<void> =>
  AsyncStorage.multiRemove(postHogStorageKeys);

/**
 * A PostHog client that can be held and retired. While held it sends
 * nothing: a request fails as a network failure, which keeps queued events
 * queued. Once retired it sends nothing, and once its cleared storage is
 * saved it writes nothing more. The SDK keeps an AppState listener and
 * pending flag requests alive after shutdown, and saves its whole storage
 * blob on each write, so a retired client could otherwise send late requests
 * or overwrite a newer client's storage.
 */
class RetirablePostHog extends PostHog {
  networkRetired = false;
  networkHeld = false;

  override fetch(
    ...[url, options]: Parameters<PostHog["fetch"]>
  ): ReturnType<PostHog["fetch"]> {
    if (this.networkRetired) {
      return Promise.reject(new Error("Analytics was withdrawn."));
    }
    if (this.networkHeld) {
      return Promise.reject(
        new Error("Analytics waits for the account's consent check.")
      );
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
  remoteFeatureFlags,
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
    // Turns every flag reload, identify() and reset() included, into a no-op.
    disableRemoteFeatureFlags: !remoteFeatureFlags,
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
    holdNetwork: (held) => {
      if (posthog.networkHeld === held) return;
      posthog.networkHeld = held;
      // Sends what waited in the queue; a failure leaves it queued.
      if (!held) void posthog.flush().catch(() => undefined);
    },
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
