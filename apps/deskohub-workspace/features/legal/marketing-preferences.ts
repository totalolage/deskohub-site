import type { MarketingConsentStatus } from "./marketing-consent-status";

export type MarketingPreferencesManagedState =
  | {
      readonly status: MarketingConsentStatus;
      readonly source: "link";
      readonly context: string;
      readonly dismissalContext: string;
    }
  | {
      readonly status: MarketingConsentStatus;
      readonly source: "account";
      readonly context: string;
    };

export type MarketingPreferencesState =
  | MarketingPreferencesManagedState
  | {
      readonly status: "pending-link";
      readonly context: string;
      readonly dismissalContext: string;
    }
  | {
      readonly status: "invalid-link";
      readonly dismissalContext: string;
    }
  | {
      readonly status: "unavailable";
    };

/**
 * Managed states render the marketing preference as a controllable row with a
 * live switch; fallback states render separately spaced guidance instead.
 */
export function isManagedMarketingState(
  state: MarketingPreferencesState
): state is MarketingPreferencesManagedState {
  return (
    state.status === "absent" ||
    state.status === "active" ||
    state.status === "withdrawn"
  );
}

/**
 * Why a marketing-preferences action refused the request. The action returns
 * it as result data, and the form shows the reason's own copy.
 */
export type MarketingPreferencesRejectionReason =
  | "invalid-link"
  | "pending-confirmation-required"
  | "stale-context";

/** What a refused marketing-preferences action returns. */
export type MarketingPreferencesRejection = {
  readonly status: "rejected";
  readonly reason: MarketingPreferencesRejectionReason;
};

export type MarketingPreferencesMutationFailureReason =
  | MarketingPreferencesRejectionReason
  | "unavailable";
