import type {
  CheckoutSummary,
  CheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import {
  getEarlyPerformanceRequestRequiredAt,
  isEarlyPerformanceRequestRequired,
} from "@/features/legal/early-performance";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import { getPayStateExpiresAt } from "./checkout-pay-url";
import {
  getSignedPayStateCheckoutSummary,
  type SignedPayState,
} from "./pay-state";

/**
 * What a client shows for one signed Pay state: the order, its summary, a
 * pending price review, and whether submitting it needs the early-performance
 * request. The Pay page computes the same facts from the same state.
 */
export type PayStateCheckoutView = {
  readonly orderId: WorkspaceReservationId;
  /** The instant the Pay state token stops being accepted. */
  readonly expiresAt: string;
  readonly summary: CheckoutSummary;
  /** Set while the customer still has to accept a price change. */
  readonly changedKeys: CheckoutSummaryChangedKeys | undefined;
  readonly earlyPerformanceConsent: {
    readonly required: boolean;
    /** From this instant on, submitting needs the early-performance request. */
    readonly requiredFrom: string;
  };
};

export const getPayStateCheckoutView = (
  state: SignedPayState,
  now: Temporal.Instant
): PayStateCheckoutView => ({
  orderId: state.orderId,
  expiresAt: getPayStateExpiresAt(state),
  summary: getSignedPayStateCheckoutSummary(state),
  changedKeys: state.changedKeys,
  earlyPerformanceConsent: {
    required: isEarlyPerformanceRequestRequired({
      reservation: state.reservation,
      contractAt: now,
    }),
    requiredFrom: temporalInstantToIsoString(
      getEarlyPerformanceRequestRequiredAt(state.reservation)
    ),
  },
});
