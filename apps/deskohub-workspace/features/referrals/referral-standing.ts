import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { discountApplications } from "@/db/schema/discount-applications";
import { paymentAttempts } from "@/db/schema/payment-attempts";
import {
  referralAttributions,
  referralInvitationClaims,
} from "@/db/schema/referrals";
import { workspaceReservations } from "@/db/schema/workspace-reservations";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import type { ReferralCode } from "./client";
import type { ReferralAccountSummary } from "./contracts";
import {
  getReferralInvitationDiscountId,
  getReferralReferrerDiscountId,
} from "./discount-identifiers";
import {
  countEligibleReferralInvitees,
  hasPreviousPaidBooking,
  hasPriorConfirmedDotyposBooking,
  type ReferralHistoryEvidence,
} from "./eligibility";
import { formatReferrerDiscountPercentage } from "./referrer-discount";

const isReservationCancelled = (input: {
  readonly dotyposStatus: string;
  readonly reservationState?: string;
}) =>
  input.dotyposStatus === "CANCELLED" ||
  input.reservationState === "cancelled" ||
  input.reservationState === "hold_expired";

/**
 * A customer's standing in the referral program: their bookings as referral
 * evidence, their invitees and their savings. These reads fan out across
 * Dotypos and the database, so they run outside every Workspace transaction.
 * Inside one, read history with `loadCustomerHistoryInTurn`.
 */
export const makeReferralStandingReads = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const dotypos = yield* DotyposService;

  const findLocalReservations = (dotyposCustomerId: DotyposCustomerId) =>
    db
      .select({
        dotyposReservationId: workspaceReservations.dotyposReservationId,
        reservationState: workspaceReservations.reservationState,
        paymentState: workspaceReservations.paymentState,
      })
      .from(workspaceReservations)
      .where(eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId));

  const listDotyposReservations = (dotyposCustomerId: DotyposCustomerId) =>
    dotypos.listReservations({
      customerId: dotyposCustomerId,
      order: "startDateDescending",
    });

  const summarizeCustomerHistory = (
    dotyposCustomerId: DotyposCustomerId,
    [localReservations, dotyposReservations]: readonly [
      Effect.Success<ReturnType<typeof findLocalReservations>>,
      Effect.Success<ReturnType<typeof listDotyposReservations>>,
    ]
  ) => {
    const localById = new Map(
      localReservations.flatMap((reservation) =>
        reservation.dotyposReservationId
          ? [[reservation.dotyposReservationId, reservation] as const]
          : []
      )
    );
    const evidence: ReferralHistoryEvidence[] = dotyposReservations.map(
      (reservation) => {
        const local = reservation.id
          ? localById.get(reservation.id)
          : undefined;
        const localPaymentState = (() => {
          if (!local) return null;
          if (local.paymentState === "paid") return "paid";
          return "unpaid";
        })();
        return {
          dotyposCustomerId,
          localPaymentState,
          dotyposStatus: reservation.status,
          cancelled: isReservationCancelled({
            dotyposStatus: reservation.status,
            reservationState: local?.reservationState,
          }),
          // The Dotypos contract only returns readable ends, so an
          // unreadable one is a defect.
          endsAt: Option.getOrThrowWith(
            decodeBookedReservation(reservation).end,
            () => new Error("Dotypos reservation end is unreadable.")
          ),
        };
      }
    );
    const hasLocalPaidBooking = localReservations.some(
      ({ paymentState }) => paymentState === "paid"
    );
    return {
      evidence,
      hasPreviousPaidBooking: hasPreviousPaidBooking({
        hasLocalPaidBooking,
        hasPriorConfirmedDotyposBooking:
          hasPriorConfirmedDotyposBooking(evidence),
      }),
    };
  };

  const loadCustomerHistory = Effect.fn("ReferralStanding.loadCustomerHistory")(
    (dotyposCustomerId: DotyposCustomerId) =>
      Effect.all(
        [
          findLocalReservations(dotyposCustomerId),
          listDotyposReservations(dotyposCustomerId),
        ],
        { concurrency: "inherit" }
      ).pipe(
        Effect.map((reads) =>
          summarizeCustomerHistory(dotyposCustomerId, reads)
        )
      )
  );

  /**
   * The same reads one at a time, for a Workspace transaction: a failed
   * Dotypos call can then never interrupt an in-flight query and break the
   * transaction's rollback.
   */
  const loadCustomerHistoryInTurn = Effect.fn(
    "ReferralStanding.loadCustomerHistoryInTurn"
  )((dotyposCustomerId: DotyposCustomerId) =>
    Effect.all([
      findLocalReservations(dotyposCustomerId),
      listDotyposReservations(dotyposCustomerId),
    ]).pipe(
      Effect.map((reads) => summarizeCustomerHistory(dotyposCustomerId, reads))
    )
  );

  const findInvitees = Effect.fn("ReferralStanding.findInvitees")(
    (referrerDotyposCustomerId: DotyposCustomerId) =>
      db
        .select({
          invitedDotyposCustomerId:
            referralAttributions.invitedDotyposCustomerId,
        })
        .from(referralAttributions)
        .where(
          eq(
            referralAttributions.referrerDotyposCustomerId,
            referrerDotyposCustomerId
          )
        )
        .pipe(
          Effect.map((rows) =>
            rows.map(({ invitedDotyposCustomerId }) => invitedDotyposCustomerId)
          )
        )
  );

  const countEligibleInvitees = Effect.fn(
    "ReferralStanding.countEligibleInvitees"
  )((invitees: readonly DotyposCustomerId[]) =>
    Effect.forEach(invitees, (invitee) => loadCustomerHistory(invitee), {
      concurrency: 4,
    }).pipe(
      Effect.map((histories) =>
        countEligibleReferralInvitees({
          now: Temporal.Now.instant(),
          referrals: histories.flatMap(({ evidence }) => evidence),
        })
      )
    )
  );

  const eligibleInviteeCount = Effect.fn(
    "ReferralStanding.eligibleInviteeCount"
  )((referrerDotyposCustomerId: DotyposCustomerId) =>
    findInvitees(referrerDotyposCustomerId).pipe(
      Effect.flatMap(countEligibleInvitees)
    )
  );

  /**
   * Sums both referral benefits (the first-booking invitation and the
   * referrer discount) on the customer's own successfully paid bookings.
   * A refunded payment keeps only the unrefunded share of each discount,
   * rounded to the minor unit; a payment marked for refund keeps none.
   */
  const findSavings = Effect.fn("ReferralStanding.findSavings")(
    (dotyposCustomerId: DotyposCustomerId) => {
      const saved = sql<number>`coalesce(sum(case
        when ${paymentAttempts.refundState} = 'refunded'
          then round(
            ${discountApplications.appliedAmountValue}::numeric
              * greatest(${paymentAttempts.amountValue} - ${paymentAttempts.refundedAmountValue}, 0)
              / ${paymentAttempts.amountValue}
          )
        else ${discountApplications.appliedAmountValue}
      end), 0)::integer`;
      return db
        .select({
          currency: discountApplications.appliedAmountCurrency,
          exponent: discountApplications.appliedAmountExponent,
          value: saved,
        })
        .from(discountApplications)
        .innerJoin(
          paymentAttempts,
          eq(paymentAttempts.id, discountApplications.paymentAttemptId)
        )
        .innerJoin(
          workspaceReservations,
          eq(
            workspaceReservations.id,
            discountApplications.workspaceReservationId
          )
        )
        .where(
          and(
            eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId),
            inArray(discountApplications.publicDiscountId, [
              getReferralInvitationDiscountId(dotyposCustomerId),
              getReferralReferrerDiscountId(dotyposCustomerId),
            ]),
            eq(paymentAttempts.state, "paid"),
            inArray(paymentAttempts.refundState, ["not_required", "refunded"])
          )
        )
        .groupBy(
          discountApplications.appliedAmountCurrency,
          discountApplications.appliedAmountExponent
        )
        .having(gt(saved, 0))
        .orderBy(asc(discountApplications.appliedAmountCurrency));
    }
  );

  /**
   * `closed` once the customer has a prior paid booking, `claimed` while
   * another payment holds the invitation, otherwise `open`.
   */
  const findInvitationWindow = Effect.fn(
    "ReferralStanding.findInvitationWindow"
  )((dotyposCustomerId: DotyposCustomerId) =>
    Effect.all(
      [
        loadCustomerHistory(dotyposCustomerId),
        db
          .select({ state: referralInvitationClaims.state })
          .from(referralInvitationClaims)
          .where(
            and(
              eq(
                referralInvitationClaims.invitedDotyposCustomerId,
                dotyposCustomerId
              ),
              inArray(referralInvitationClaims.state, ["reserved", "redeemed"])
            )
          )
          .limit(1),
      ],
      { concurrency: "inherit" }
    ).pipe(
      Effect.map(([history, activeClaims]) => {
        if (history.hasPreviousPaidBooking) return "closed" as const;
        if (activeClaims.length > 0) return "claimed" as const;
        return "open" as const;
      })
    )
  );

  /**
   * The referrer's account summary, reading their invitees and savings while
   * `code` issues or finds their referral code.
   */
  const loadAccountSummary = <E, R>(input: {
    readonly referrerDotyposCustomerId: DotyposCustomerId;
    readonly code: Effect.Effect<ReferralCode, E, R>;
  }) =>
    Effect.all(
      [
        input.code,
        findInvitees(input.referrerDotyposCustomerId).pipe(
          Effect.flatMap((invitees) =>
            countEligibleInvitees(invitees).pipe(
              Effect.map((eligible) => ({
                total: invitees.length,
                eligible,
              }))
            )
          )
        ),
        findSavings(input.referrerDotyposCustomerId),
      ],
      { concurrency: "inherit" }
    ).pipe(
      Effect.map(
        ([code, invitees, savings]): ReferralAccountSummary => ({
          code,
          inviteeCount: invitees.total,
          eligibleInviteeCount: invitees.eligible,
          discount: formatReferrerDiscountPercentage(invitees.eligible),
          savings,
        })
      )
    );

  return {
    loadCustomerHistoryInTurn,
    eligibleInviteeCount,
    findInvitationWindow,
    loadAccountSummary,
  };
});
