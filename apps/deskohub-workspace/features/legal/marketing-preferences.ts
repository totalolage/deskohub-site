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

export const marketingPreferencesMutationFailureReasons = [
  "invalid-link",
  "pending-confirmation-required",
  "stale-context",
  "unavailable",
] as const;

export type MarketingPreferencesMutationFailureReason =
  (typeof marketingPreferencesMutationFailureReasons)[number];

export const isMarketingPreferencesMutationFailureReason = (
  serverError: string | undefined
): serverError is MarketingPreferencesMutationFailureReason =>
  marketingPreferencesMutationFailureReasons.some(
    (reason) => reason === serverError
  );
