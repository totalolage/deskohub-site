/**
 * An account's analytics consent decision: a grant accepts analytics, a
 * withdrawal declines it.
 */
export const analyticsConsentDecisions = ["grant", "withdraw"] as const;

export type AnalyticsConsentDecision =
  (typeof analyticsConsentDecisions)[number];

/**
 * Where an account's analytics consent decision came from: a banner save
 * while signed in, a mirror of the device's banner choice at sign-in or when
 * a signed-in session is used (its hydration, or an authenticated action that
 * reads the consent cookie), the one-off backfill of earlier consent, account
 * preferences, or a mirror of the native app's own choice. Stored decisions
 * keep their value even if a source is later removed.
 */
export const analyticsConsentDecisionSources = [
  "banner",
  "sign_in_mirror",
  "hydration_mirror",
  "backfill",
  "preference",
  "app_mirror",
] as const;

export type AnalyticsConsentDecisionSource =
  (typeof analyticsConsentDecisionSources)[number];

/**
 * The sources that copy a device's own choice into the ledger: the web's
 * banner choice, or the native app's.
 */
export type AnalyticsConsentMirrorSource = Extract<
  AnalyticsConsentDecisionSource,
  "sign_in_mirror" | "hydration_mirror" | "app_mirror"
>;
