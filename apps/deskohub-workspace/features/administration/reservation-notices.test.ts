import { describe, expect, test } from "bun:test";
import type { LatePaymentRecoveryState } from "@/db/schema";
import {
  getReservationOperatorNotice,
  getReservationStatusNote,
} from "./reservation-notices";

const unconfirmedPayment = "payment_outcome_unconfirmed_before_cleanup";

const settled = {
  failureCode: null,
  latePayment: false,
  refunded: false,
} as const;

describe("getReservationOperatorNotice", () => {
  test.each([
    ["pending", "late_payment_recovery_in_progress", "warning"],
    ["processing", "late_payment_recovery_in_progress", "warning"],
    ["recovered", "late_payment_recovered", "success"],
    ["review_required", "late_payment_recovery_review_required", "error"],
  ] as const)(
    "names a %s recovery ahead of the late payment and a payment review",
    (recoveryState, kind, status) => {
      expect(
        getReservationOperatorNotice({
          failureCode: unconfirmedPayment,
          latePayment: true,
          recoveryState,
          refunded: true,
        })
      ).toEqual({ kind, status });
    }
  );

  test("leaves a recovery that ended in a refund to the late payment", () => {
    expect(
      getReservationOperatorNotice({
        ...settled,
        latePayment: true,
        recoveryState: "refund_required",
      })
    ).toEqual({ kind: "late_payment_refund_required", status: "error" });
  });

  test("shows a late payment as refunded once Nexi refunded it", () => {
    expect(
      getReservationOperatorNotice({
        ...settled,
        failureCode: unconfirmedPayment,
        latePayment: true,
        refunded: true,
      })
    ).toEqual({ kind: "late_payment_refunded", status: "success" });
  });

  test("asks for a payment review when cleanup couldn't confirm the outcome", () => {
    expect(
      getReservationOperatorNotice({
        ...settled,
        failureCode: unconfirmedPayment,
      })
    ).toEqual({ kind: "payment_review", status: "warning" });
  });

  test("shows no notice for a refund alone or another failure", () => {
    expect(
      getReservationOperatorNotice({ ...settled, refunded: true })
    ).toBeNull();
    expect(
      getReservationOperatorNotice({
        ...settled,
        failureCode: "dotypos_booking_failed",
      })
    ).toBeNull();
  });

  test("returns a notice the caller may own", () => {
    const first = getReservationOperatorNotice({
      ...settled,
      recoveryState: "pending",
    });
    const second = getReservationOperatorNotice({
      ...settled,
      recoveryState: "pending",
    });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe("getReservationStatusNote", () => {
  const quiet = {
    ...settled,
    dotyposStatus: "CONFIRMED",
    needsRefund: false,
    reservationState: "confirmed",
  } as const;

  test("puts a payment needing a refund ahead of every other note", () => {
    expect(
      getReservationStatusNote({
        ...quiet,
        dotyposStatus: "CANCELLED",
        failureCode: unconfirmedPayment,
        latePayment: true,
        needsRefund: true,
        recoveryState: "pending",
        refunded: true,
      })
    ).toBe("needs_refund");
  });

  test.each([
    ["pending", "recovery_in_progress"],
    ["processing", "recovery_in_progress"],
    ["review_required", "recovery_review"],
  ] as const)("notes a %s recovery ahead of refunds", (recoveryState, note) => {
    expect(
      getReservationStatusNote({
        ...quiet,
        latePayment: true,
        recoveryState,
        refunded: true,
      })
    ).toBe(note);
  });

  test.each([
    "recovered",
    "refund_required",
  ] as const satisfies readonly LatePaymentRecoveryState[])(
    "lets a %s recovery fall through to the refund state",
    (recoveryState) => {
      expect(
        getReservationStatusNote({ ...quiet, recoveryState, refunded: true })
      ).toBe("refunded");
      expect(
        getReservationStatusNote({ ...quiet, latePayment: true, recoveryState })
      ).toBe("refund_required");
    }
  );

  test("notes a refund ahead of the late payment it settled", () => {
    expect(
      getReservationStatusNote({ ...quiet, latePayment: true, refunded: true })
    ).toBe("refunded");
  });

  test("notes a payment review ahead of a Dotypos cancellation", () => {
    expect(
      getReservationStatusNote({
        ...quiet,
        dotyposStatus: "CANCELLED",
        failureCode: unconfirmedPayment,
      })
    ).toBe("payment_review");
  });

  test("notes a booking Dotypos cancelled while Workspace still holds the reservation", () => {
    expect(
      getReservationStatusNote({ ...quiet, dotyposStatus: "CANCELLED" })
    ).toBe("cancelled_in_dotypos");
    expect(
      getReservationStatusNote({
        ...quiet,
        dotyposStatus: "CANCELLED",
        reservationState: "cancelled",
      })
    ).toBeNull();
  });

  test("has no note for a settled reservation or one without a live booking", () => {
    expect(getReservationStatusNote(quiet)).toBeNull();
    expect(
      getReservationStatusNote({ ...quiet, dotyposStatus: undefined })
    ).toBeNull();
  });
});
