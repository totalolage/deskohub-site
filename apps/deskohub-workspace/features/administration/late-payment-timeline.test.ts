import { describe, expect, test } from "bun:test";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  buildLatePaymentRecoveryTimeline,
  buildLatePaymentTimeline,
  type LatePaymentRecoveryRow,
} from "./late-payment-timeline";

const reservationId = workspaceReservationIdSchema.make(
  "synthetic-reservation"
);
const verifiedPaidAt = Temporal.Instant.from("2026-10-01T10:00:00Z");
const completedAt = Temporal.Instant.from("2026-10-01T10:05:00Z");

const recovery = (
  overrides: Partial<LatePaymentRecoveryRow>
): LatePaymentRecoveryRow => ({
  paymentAttemptId: paymentAttemptIdSchema.make("synthetic-payment"),
  reservationId,
  state: "pending",
  failureCode: null,
  verifiedPaidAt,
  completedAt: null,
  ...overrides,
});

const withoutCopy = ({
  event,
  id,
  occurredAt,
  tone,
}: ReturnType<typeof buildLatePaymentTimeline>[number]) => ({
  event,
  id,
  occurredAt,
  tone,
});

describe("buildLatePaymentTimeline", () => {
  test("records each late payment as a warning when Nexi reported it", () => {
    expect(
      buildLatePaymentTimeline([
        { eventId: "first", receivedAt: verifiedPaidAt, reservationId },
        { eventId: "second", receivedAt: completedAt, reservationId },
      ]).map(withoutCopy)
    ).toEqual([
      {
        event: { source: "reservation", kind: "late_payment" },
        id: "late-payment-first",
        occurredAt: "2026-10-01T10:00:00Z",
        tone: "warning",
      },
      {
        event: { source: "reservation", kind: "late_payment" },
        id: "late-payment-second",
        occurredAt: "2026-10-01T10:05:00Z",
        tone: "warning",
      },
    ]);
  });
});

describe("buildLatePaymentRecoveryTimeline", () => {
  const started = {
    event: { source: "reservation", kind: "late_payment_recovery_started" },
    id: "late-payment-recovery-synthetic-payment-detected",
    occurredAt: "2026-10-01T10:00:00Z",
    tone: "warning",
  } as const;

  test("shows only the start of a recovery still running", () => {
    expect(
      buildLatePaymentRecoveryTimeline([recovery({ state: "processing" })]).map(
        withoutCopy
      )
    ).toEqual([started]);
  });

  test.each([
    ["recovered", "late_payment_recovered", "positive"],
    ["refund_required", "late_payment_recovery_refund_required", "warning"],
    ["review_required", "late_payment_recovery_review_required", "warning"],
  ] as const)(
    "follows the start of a %s recovery with how it ended",
    (state, kind, tone) => {
      const items = buildLatePaymentRecoveryTimeline([
        recovery({ state, completedAt }),
      ]);

      expect(items.map(withoutCopy)).toEqual([
        started,
        {
          event: { source: "reservation", kind },
          id: `late-payment-recovery-synthetic-payment-${state}`,
          occurredAt: "2026-10-01T10:05:00Z",
          tone,
        },
      ]);
      expect(items[1]?.title).toEqual(expect.any(String));
      expect(items[1]?.description).toEqual(expect.any(String));
    }
  );

  test("keeps each recovery's items together, in recovery order", () => {
    const items = buildLatePaymentRecoveryTimeline([
      recovery({
        paymentAttemptId: paymentAttemptIdSchema.make("first"),
        state: "refund_required",
        completedAt,
      }),
      recovery({ paymentAttemptId: paymentAttemptIdSchema.make("second") }),
    ]);

    expect(items.map(({ id }) => id)).toEqual([
      "late-payment-recovery-first-detected",
      "late-payment-recovery-first-refund_required",
      "late-payment-recovery-second-detected",
    ]);
  });
});
