import type { DotyposCustomerId } from "@deskohub/dotypos";

export type ReferralHistoryEvidence = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly localPaymentState: "paid" | "unpaid" | null;
  readonly dotyposStatus: "CONFIRMED" | "NEW" | "CANCELLED" | null;
  readonly cancelled: boolean;
  readonly endsAt: Temporal.Instant;
};

export const referralHistoryWindowMilliseconds = 30 * 24 * 60 * 60 * 1000;

export const countEligibleReferralInvitees = (input: {
  readonly referrals: readonly ReferralHistoryEvidence[];
  readonly now: Temporal.Instant;
}): number => {
  const cutoff = input.now.subtract({
    milliseconds: referralHistoryWindowMilliseconds,
  });
  const eligible = new Set<DotyposCustomerId>();

  for (const referral of input.referrals) {
    if (
      referral.localPaymentState === "paid" &&
      referral.dotyposStatus === "CONFIRMED" &&
      !referral.cancelled &&
      Temporal.Instant.compare(referral.endsAt, cutoff) > 0 &&
      Temporal.Instant.compare(referral.endsAt, input.now) <= 0
    ) {
      eligible.add(referral.dotyposCustomerId);
    }
  }

  return eligible.size;
};

export const hasPreviousPaidBooking = (input: {
  readonly hasLocalPaidBooking: boolean;
  readonly hasPriorConfirmedDotyposBooking: boolean;
}): boolean =>
  input.hasLocalPaidBooking || input.hasPriorConfirmedDotyposBooking;

export const hasPriorConfirmedDotyposBooking = (
  evidence: readonly ReferralHistoryEvidence[]
): boolean =>
  evidence.some(
    (booking) =>
      booking.localPaymentState === null &&
      booking.dotyposStatus === "CONFIRMED" &&
      !booking.cancelled
  );
