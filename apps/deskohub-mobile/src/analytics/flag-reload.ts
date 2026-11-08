/** The parts of the SDK's stored flags record that say how a response went. */
export interface StoredFlagResponse {
  readonly quotaLimited?: readonly string[];
  readonly errorsWhileComputingFlags?: boolean;
}

/**
 * Why a flags reload did not yield values for the current identity, or
 * `undefined` when it did. A failed request resolves with no flags; a
 * quota-limited or partial response keeps cached values, which may be the
 * previous identity's.
 */
export const failedFlagReload = (
  flags: Readonly<Record<string, boolean | string>> | undefined,
  stored: StoredFlagResponse | undefined
): string | undefined => {
  if (flags === undefined || stored === undefined) {
    return "No feature flags returned.";
  }
  if (stored.quotaLimited?.includes("feature_flags")) {
    return "The feature flag quota is exceeded.";
  }
  if (stored.errorsWhileComputingFlags === true) {
    return "Some feature flags failed to compute.";
  }
  return undefined;
};
