import type { LatePaymentRecoveryState } from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { AdministrationTimelineItem } from "./administration.service";

/** A Nexi webhook that reported payment after Workspace released the reservation. */
export type LatePaymentEventRow = {
  readonly eventId: string;
  readonly receivedAt: Temporal.Instant;
  readonly reservationId: WorkspaceReservationId;
};

/** Workspace's attempt to fulfill a reservation that Nexi reported paid late. */
export type LatePaymentRecoveryRow = {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly reservationId: WorkspaceReservationId;
  readonly state: LatePaymentRecoveryState;
  readonly failureCode: string | null;
  readonly verifiedPaidAt: Temporal.Instant;
  readonly completedAt: Temporal.Instant | null;
};

/** One timeline item for each late payment Nexi reported. */
export const buildLatePaymentTimeline = (
  events: readonly LatePaymentEventRow[]
): readonly AdministrationTimelineItem[] =>
  events.map((event) => ({
    id: `late-payment-${event.eventId}`,
    event: { source: "reservation", kind: "late_payment" },
    title: "Late payment — refund required",
    description:
      "Nexi reported payment after Workspace released the reservation. The reservation was not fulfilled and the payment requires an operator refund.",
    occurredAt: event.receivedAt.toString(),
    tone: "warning",
  }));

type CompletedLatePaymentRecoveryState = Exclude<
  LatePaymentRecoveryState,
  "pending" | "processing"
>;

/**
 * The timeline of each late-payment recovery: when it started and, once it
 * completed, how it ended.
 */
export const buildLatePaymentRecoveryTimeline = (
  recoveries: readonly LatePaymentRecoveryRow[]
): readonly AdministrationTimelineItem[] =>
  recoveries.flatMap((recovery) => {
    const detected: AdministrationTimelineItem = {
      id: `late-payment-recovery-${recovery.paymentAttemptId}-detected`,
      event: { source: "reservation", kind: "late_payment_recovery_started" },
      title: "Late payment recovery started",
      description:
        "Nexi reported payment after local expiration. Workspace is checking whether the reservation can still be fulfilled.",
      occurredAt: recovery.verifiedPaidAt.toString(),
      tone: "warning",
    };
    if (!recovery.completedAt) return [detected];
    return [
      detected,
      {
        id: `late-payment-recovery-${recovery.paymentAttemptId}-${recovery.state}`,
        event: {
          source: "reservation",
          kind: (
            {
              recovered: "late_payment_recovered",
              refund_required: "late_payment_recovery_refund_required",
              review_required: "late_payment_recovery_review_required",
            } as const
          )[recovery.state as CompletedLatePaymentRecoveryState],
        },
        title: {
          recovered: "Late payment recovered",
          refund_required: "Late payment — refund required",
          review_required: "Late payment recovery needs review",
        }[recovery.state as CompletedLatePaymentRecoveryState],
        description: {
          recovered:
            "Workspace secured a valid booking and continued normal paid fulfillment.",
          refund_required:
            "The reservation could not be safely recovered. Refund the payment in Nexi.",
          review_required:
            "Workspace could not safely determine or complete recovery. Operator review is required.",
        }[recovery.state as CompletedLatePaymentRecoveryState],
        occurredAt: recovery.completedAt.toString(),
        tone: recovery.state === "recovered" ? "positive" : "warning",
      },
    ];
  });
