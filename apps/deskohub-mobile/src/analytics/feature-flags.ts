import { useSyncExternalStore } from "react";
import { analytics } from "./analytics";

/**
 * Whether a flag value turns the feature on: a variant counts as on, and no
 * value yet gives the caller's fallback.
 */
export const resolveFeatureFlagEnabled = (
  value: boolean | string | undefined,
  fallback: boolean
): boolean => (value === undefined ? fallback : value !== false);

/**
 * Whether a PostHog feature flag is on for the settled identity. Returns
 * `fallback` until flags load, without analytics consent, and again after
 * consent is withdrawn.
 */
export const useFeatureFlagEnabled = (
  flag: string,
  fallback: boolean
): boolean => {
  const read = () =>
    resolveFeatureFlagEnabled(analytics.featureFlag(flag), fallback);
  return useSyncExternalStore(analytics.subscribeFeatureFlags, read, read);
};
