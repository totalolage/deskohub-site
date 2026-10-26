export type MarketingPreferencesManagedState =
  | {
      readonly status: "absent" | "active" | "withdrawn";
      readonly source: "link";
      readonly context: string;
      readonly dismissalContext: string;
    }
  | {
      readonly status: "absent" | "active" | "withdrawn";
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
 * A customer's stored marketing consent: none recorded, currently granted, or
 * withdrawn after a grant.
 */
export const getMarketingPreferenceStatus = (
  consent: { readonly withdrawnAt: Temporal.Instant | null } | null
): MarketingPreferencesManagedState["status"] => {
  if (consent === null) return "absent";
  return consent.withdrawnAt === null ? "active" : "withdrawn";
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
