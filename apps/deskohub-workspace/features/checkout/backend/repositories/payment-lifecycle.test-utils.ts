import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import { makeAccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { calculateDiscounts } from "@/features/discounts/calculator";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { promotionCodeIdSchema } from "@/features/discounts/persistence-contracts";
import type { DiscountCandidate } from "@/features/discounts/provider";
import { type Locale, m } from "@/features/i18n";
import { getReferralInvitationDiscountId } from "@/features/referrals/discount-identifiers";
import { referralInvitationDiscountBasisPoints } from "@/features/referrals/program";
import { fixtureReservationAuthorId } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { IPaymentLifecycleRepository } from "./payment-lifecycle.repository";

type Reservation = typeof workspaceReservations.$inferSelect;

const product = { kind: "cowork", tier: "basic" } as const;
const reservationDetails = {
  kind: "cowork",
  entryTier: "basic",
  coffee: false,
} as const;
const locale: Locale = "en-US";

/** A synthetic held cowork reservation, ready for a payment attempt. */
export const createHeldReservation = (
  db: WorkspaceDatabaseClient,
  dotyposCustomerId: DotyposCustomerId
) =>
  db
    .insert(workspaceReservations)
    .values({
      authorAccountId: fixtureReservationAuthorId,
      checkoutAttemptKey: checkoutAttemptKeySchema.make(
        `payment-${crypto.randomUUID()}`
      ),
      dotyposCustomerId,
      dotyposReservationId:
        `dotypos-${crypto.randomUUID()}` as DotyposReservationId,
      reservationState: "held",
      paymentState: "not_started",
      fulfillmentState: "not_started",
      reservationDetails,
      locale,
      reservationHoldExpiresAt: Temporal.Now.instant().add({ hours: 1 }),
    })
    .returning()
    .pipe(Effect.map(([reservation]) => reservation!));

const makeInvitationCandidate = (referral: {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly promotionCodeId: string;
}): DiscountCandidate => {
  const promotionCodeId = promotionCodeIdSchema.make(referral.promotionCodeId);
  return {
    discount: {
      id: getReferralInvitationDiscountId(referral.invitedDotyposCustomerId),
      label: m.checkoutSummaryItemReferralInvitationDiscount({}, { locale }),
      adjustment: {
        kind: "percentage",
        basisPoints: referralInvitationDiscountBasisPoints,
      },
    },
    provenance: {
      providerNamespace: "referral-invitation",
      providerReference: referral.promotionCodeId,
      details: {
        referralInvitation: {
          invitedDotyposCustomerId: referral.invitedDotyposCustomerId,
          referrerDotyposCustomerId: referral.referrerDotyposCustomerId,
          promotionCodeId,
        },
      },
    },
    claim: {
      kind: "referral_invitation",
      invitedDotyposCustomerId: referral.invitedDotyposCustomerId,
      referrerDotyposCustomerId: referral.referrerDotyposCustomerId,
      promotionCodeId,
    },
  };
};

/**
 * Starts a Nexi payment for a held reservation through the real lifecycle
 * admission. With `referral`, the attempt carries a checkout referral: it
 * reserves the invitation claim and records the attribution when paid.
 */
export const admitPendingNexiPayment = (
  repository: IPaymentLifecycleRepository,
  reservation: Reservation,
  referral?: {
    readonly referrerDotyposCustomerId: DotyposCustomerId;
    readonly promotionCodeId: string;
  }
) =>
  Effect.gen(function* () {
    const dotyposCustomerId =
      reservation.dotyposCustomerId as DotyposCustomerId;
    const baseQuote = yield* buildCoworkReservationQuote(reservationDetails);
    const calculation = referral
      ? yield* calculateDiscounts({
          product,
          discountableSubtotal: baseQuote.payment.expectedPrice,
          candidates: [
            makeInvitationCandidate({
              invitedDotyposCustomerId: dotyposCustomerId,
              ...referral,
            }),
          ],
        })
      : undefined;
    const quote = yield* buildCoworkReservationQuote(
      reservationDetails,
      calculation ? { discountQuote: calculation.quote } : {}
    );
    const snapshot = makeAccountingDocumentSnapshot({
      workspaceReservationId: reservation.id,
      dotyposReservationId: reservation.dotyposReservationId!,
      dotyposCustomerId,
      locale,
      prepared: {
        kind: "cowork",
        reservation: {
          ...reservationDetails,
          date: "2099-01-01",
          name: "Synthetic Customer",
          email: testEmailAddress("synthetic"),
          phone: "+420 700 000 000",
        },
        quote,
      } as PreparedCustomerQuote,
    });
    return yield* repository.createPendingNexiAttempt({
      workspaceReservationId: reservation.id,
      providerOrderId: `order-${crypto.randomUUID()}` as never,
      amount: snapshot.quote.payment.expectedPrice,
      commitment: makeDiscountCommitment({
        product,
        applications: calculation?.applications ?? [],
      }),
      locale,
      accountingSnapshot: snapshot,
    });
  });
