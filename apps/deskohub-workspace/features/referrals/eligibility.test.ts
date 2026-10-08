import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  countEligibleReferralInvitees,
  hasPreviousPaidBooking,
  hasPriorConfirmedDotyposBooking,
} from "./eligibility";

const customer = (value: string) => value as DotyposCustomerId;
const instant = (value: string) => Temporal.Instant.from(value);

describe("referral eligibility history", () => {
  test("counts distinct invitees with locally paid, live confirmed visits in the elapsed 30-day window", () => {
    const now = instant("2026-10-08T12:00:00Z");
    const referrals = [
      {
        dotyposCustomerId: customer("paid-current"),
        localPaymentState: "paid" as const,
        dotyposStatus: "CONFIRMED" as const,
        cancelled: false,
        endsAt: instant("2026-10-01T12:00:00Z"),
      },
      {
        dotyposCustomerId: customer("paid-current"),
        localPaymentState: "paid" as const,
        dotyposStatus: "CONFIRMED" as const,
        cancelled: false,
        endsAt: instant("2026-10-07T12:00:00Z"),
      },
      {
        dotyposCustomerId: customer("legacy-only"),
        localPaymentState: null,
        dotyposStatus: "CONFIRMED" as const,
        cancelled: false,
        endsAt: instant("2026-10-07T12:00:00Z"),
      },
      {
        dotyposCustomerId: customer("unpaid-hold"),
        localPaymentState: "unpaid" as const,
        dotyposStatus: "CONFIRMED" as const,
        cancelled: false,
        endsAt: instant("2026-10-07T12:00:00Z"),
      },
      {
        dotyposCustomerId: customer("cancelled"),
        localPaymentState: "paid" as const,
        dotyposStatus: "CANCELLED" as const,
        cancelled: true,
        endsAt: instant("2026-10-07T12:00:00Z"),
      },
      {
        dotyposCustomerId: customer("too-old"),
        localPaymentState: "paid" as const,
        dotyposStatus: "CONFIRMED" as const,
        cancelled: false,
        endsAt: instant("2026-09-08T12:00:00Z"),
      },
      {
        dotyposCustomerId: customer("not-ended"),
        localPaymentState: "paid" as const,
        dotyposStatus: "CONFIRMED" as const,
        cancelled: false,
        endsAt: instant("2026-10-08T12:00:01Z"),
      },
    ];

    expect(countEligibleReferralInvitees({ referrals, now })).toBe(1);
  });

  test("a locally paid booking or older confirmed Dotypos booking excludes invitation use", () => {
    expect(
      hasPreviousPaidBooking({
        hasLocalPaidBooking: false,
        hasPriorConfirmedDotyposBooking: false,
      })
    ).toBe(false);
    expect(
      hasPreviousPaidBooking({
        hasLocalPaidBooking: true,
        hasPriorConfirmedDotyposBooking: false,
      })
    ).toBe(true);
    expect(
      hasPreviousPaidBooking({
        hasLocalPaidBooking: false,
        hasPriorConfirmedDotyposBooking: true,
      })
    ).toBe(true);
  });

  test("only an older confirmed booking with no local row is a legacy exclusion", () => {
    const base = {
      dotyposCustomerId: customer("invitee"),
      cancelled: false,
      endsAt: instant("2025-01-01T00:00:00Z"),
    };

    expect(
      hasPriorConfirmedDotyposBooking([
        {
          ...base,
          localPaymentState: "unpaid",
          dotyposStatus: "CONFIRMED",
        },
      ])
    ).toBe(false);
    expect(
      hasPriorConfirmedDotyposBooking([
        {
          ...base,
          localPaymentState: null,
          dotyposStatus: "CONFIRMED",
        },
      ])
    ).toBe(true);
  });
});
