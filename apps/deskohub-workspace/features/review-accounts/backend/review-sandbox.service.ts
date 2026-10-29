import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Match, Option } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { toStoredInstant } from "@/db/instant";
import {
  customerAccounts,
  type ReviewAccountHold,
  reviewAccountHolds,
} from "@/db/schema";
import type { CustomerAgentClientId } from "@/features/account";
import type { CustomerReservationHistory } from "@/features/account/contracts";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type {
  CheckoutStatusReturnOutcome,
  CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout/checkout-status.service";
import { payStateDefaultTtlMilliseconds } from "@/features/checkout/backend/checkout/pay-state";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import type { Locale } from "@/features/i18n";
import {
  getCoworkReservationInterval,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import type { NormalizedMeetingRoomReservationOrder } from "@/features/reservation/meeting-room-reservation";
import {
  getOfficeReservationIntervalInput,
  type NormalizedOfficeReservationOrder,
} from "@/features/reservation/office-reservation";
import {
  getStoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import type { Money } from "@/shared/money/money";
import {
  currentInstant,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import { getReviewPaymentDisabledPath } from "../routes";
import {
  toReviewSandboxHistory,
  toReviewSandboxStatus,
} from "./review-sandbox-projection";
import {
  getReviewSampleReservations,
  isReviewSampleOrderId,
  type ReviewSandboxReservation,
} from "./review-sandbox-reservation";

/** A booking's normalized reservation, as the checkout prepares it. */
type ReviewSandboxOrder =
  | NormalizedCoworkReservationOrder
  | NormalizedMeetingRoomReservationOrder
  | NormalizedOfficeReservationOrder;

export type ReviewSandboxHoldRequest = {
  readonly accountId: CustomerAccountId;
  readonly locale: Locale;
  /**
   * The checkout session a new selection supersedes the open hold in; an
   * agent's is one per account and agent client.
   */
  readonly checkoutSessionId: CheckoutSessionId;
  /**
   * Names the booking request: the agent's selection key, or the site
   * form's checkout attempt.
   */
  readonly selection: string;
  readonly agentClientId?: CustomerAgentClientId;
  readonly reservation: ReviewSandboxOrder;
  /** The price the booking was advertised at, which the sandbox keeps. */
  readonly total: Money;
  readonly bookedAt: Temporal.Instant;
};

/**
 * A prepared sandbox hold in the shape of a prepared Pay page, whose link
 * opens the payment-disabled page instead. `reviewSandbox` tells the booking
 * operation the hold is simulated.
 */
type ReviewSandboxHoldResult = {
  readonly status: "ready";
  readonly orderId: WorkspaceReservationId;
  readonly redirectUrl: string;
  readonly expiresAt: string;
  readonly reviewSandbox: true;
};

type ReviewSandboxError = EffectDrizzleQueryError | SqlError.SqlError;

interface IReviewSandbox {
  /**
   * Holds a review account's selection without reserving anything: the same
   * selection returns its open hold, and a new one in the same checkout
   * session cancels the session's open hold first. Run it under the
   * account lock, which serializes an account's bookings.
   */
  readonly prepareHold: (
    request: ReviewSandboxHoldRequest
  ) => Effect.Effect<ReviewSandboxHoldResult, ReviewSandboxError>;
  /** The account's samples and simulated holds as its reservation history. */
  readonly history: (
    accountId: CustomerAccountId
  ) => Effect.Effect<CustomerReservationHistory, ReviewSandboxError>;
  /**
   * The status of a sandbox order of any review account. Callers authorize
   * the order first, as for any reservation.
   */
  readonly status: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<
    Option.Option<CheckoutStatusViewModel>,
    ReviewSandboxError
  >;
  /** Whether the order is one of the account's samples or holds. */
  readonly isOrderOf: (input: {
    readonly accountId: CustomerAccountId;
    readonly orderId: WorkspaceReservationId;
  }) => Effect.Effect<boolean, ReviewSandboxError>;
}

/** The review accounts' booking sandbox. */
export class ReviewSandbox extends Context.Service<
  ReviewSandbox,
  IReviewSandbox
>()("@deskohub-workspace/review-accounts/ReviewSandbox") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const findOpenHold = (input: {
        readonly accountId: CustomerAccountId;
        readonly checkoutSessionKey: string;
        readonly selectionKey: string;
        readonly now: Temporal.Instant;
      }) =>
        db
          .select()
          .from(reviewAccountHolds)
          .where(
            and(
              eq(reviewAccountHolds.accountId, input.accountId),
              eq(
                reviewAccountHolds.checkoutSessionKey,
                input.checkoutSessionKey
              ),
              eq(reviewAccountHolds.selectionKey, input.selectionKey),
              isNull(reviewAccountHolds.cancelledAt),
              gt(reviewAccountHolds.expiresAt, input.now)
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      const replaceOpenHold = (input: {
        readonly request: ReviewSandboxHoldRequest;
        readonly checkoutSessionKey: string;
        readonly selectionKey: string;
        readonly now: Temporal.Instant;
      }) =>
        transaction(
          Effect.gen(function* () {
            yield* db
              .update(reviewAccountHolds)
              .set({ cancelledAt: input.now })
              .where(
                and(
                  eq(reviewAccountHolds.accountId, input.request.accountId),
                  eq(
                    reviewAccountHolds.checkoutSessionKey,
                    input.checkoutSessionKey
                  ),
                  isNull(reviewAccountHolds.cancelledAt),
                  gt(reviewAccountHolds.expiresAt, input.now)
                )
              );
            const bookedAt = toStoredInstant(input.request.bookedAt);
            const [hold] = yield* db
              .insert(reviewAccountHolds)
              .values({
                accountId: input.request.accountId,
                agentClientId: input.request.agentClientId ?? null,
                checkoutSessionKey: input.checkoutSessionKey,
                selectionKey: input.selectionKey,
                ...getSandboxSelection(input.request.reservation),
                totalValue: input.request.total.value,
                totalExponent: input.request.total.exponent,
                currency: input.request.total.currency,
                bookedAt,
                expiresAt: bookedAt.add({
                  milliseconds: payStateDefaultTtlMilliseconds,
                }),
              })
              .returning();
            return yield* Option.match(Option.fromNullishOr(hold), {
              onNone: () =>
                Effect.die("Review sandbox hold insert returned no row"),
              onSome: Effect.succeed,
            });
          })
        );

      const prepareHold = Effect.fn("ReviewSandbox.prepareHold")(function* (
        request: ReviewSandboxHoldRequest
      ) {
        const now = yield* currentInstant;
        const keys = {
          checkoutSessionKey: digest("session", request.checkoutSessionId),
          selectionKey: digest(
            "selection",
            request.selection,
            JSON.stringify(getSandboxSelection(request.reservation))
          ),
        };
        const open = yield* findOpenHold({
          accountId: request.accountId,
          ...keys,
          now,
        });
        const hold = yield* Option.match(open, {
          onNone: () => replaceOpenHold({ request, ...keys, now }),
          onSome: Effect.succeed,
        });
        return {
          status: "ready",
          orderId: hold.id,
          redirectUrl: getReviewPaymentDisabledPath(request.locale, hold.id),
          expiresAt: temporalInstantToIsoString(hold.expiresAt),
          reviewSandbox: true,
        } satisfies ReviewSandboxHoldResult;
      });

      const listHolds = (accountId: CustomerAccountId) =>
        db
          .select()
          .from(reviewAccountHolds)
          .where(eq(reviewAccountHolds.accountId, accountId));

      const history = Effect.fn("ReviewSandbox.history")(function* (
        accountId: CustomerAccountId
      ) {
        const now = yield* currentInstant;
        const holds = yield* listHolds(accountId);
        return toReviewSandboxHistory(
          [
            ...getReviewSampleReservations(accountId, now),
            ...holds.map((hold) => toSandboxReservation(hold, now)),
          ],
          now
        );
      });

      const findHold = (orderId: WorkspaceReservationId) =>
        db
          .select()
          .from(reviewAccountHolds)
          .where(eq(reviewAccountHolds.id, orderId))
          .limit(1)
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      // Review accounts are the handful of app-directory reviewers, so
      // checking every one's samples stays cheap; only sample IDs get here.
      const findSample = Effect.fn("ReviewSandbox.findSample")(function* (
        orderId: WorkspaceReservationId,
        now: Temporal.Instant
      ) {
        const accounts = yield* db
          .select({ id: customerAccounts.id })
          .from(customerAccounts)
          .where(
            and(
              eq(customerAccounts.review, true),
              isNull(customerAccounts.deletedAt)
            )
          );
        return Option.fromNullishOr(
          accounts
            .flatMap(({ id }) => getReviewSampleReservations(id, now))
            .find((sample) => sample.orderId === orderId)
        );
      });

      const status = Effect.fn("ReviewSandbox.status")(function* (input: {
        readonly orderId: WorkspaceReservationId;
        readonly returnOutcome: CheckoutStatusReturnOutcome;
      }) {
        const now = yield* currentInstant;
        const reservation = isReviewSampleOrderId(input.orderId)
          ? yield* findSample(input.orderId, now)
          : Option.map(yield* findHold(input.orderId), (hold) =>
              toSandboxReservation(hold, now)
            );
        return Option.map(reservation, (found) =>
          toReviewSandboxStatus(found, input.returnOutcome)
        );
      });

      const isOrderOf = Effect.fn("ReviewSandbox.isOrderOf")(function* (input: {
        readonly accountId: CustomerAccountId;
        readonly orderId: WorkspaceReservationId;
      }) {
        if (isReviewSampleOrderId(input.orderId)) {
          const now = yield* currentInstant;
          return getReviewSampleReservations(input.accountId, now).some(
            (sample) => sample.orderId === input.orderId
          );
        }
        const hold = yield* findHold(input.orderId);
        return Option.exists(
          hold,
          (found) => found.accountId === input.accountId
        );
      });

      return {
        prepareHold,
        history,
        status,
        isOrderOf,
      } satisfies IReviewSandbox;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

const digest = (kind: string, ...parts: readonly string[]) =>
  createHash("sha256")
    .update([`deskohub-workspace/review-sandbox-${kind}`, ...parts].join("\0"))
    .digest("base64url");

/** What a hold stores of a booking: the product, interval, and seats. */
const getSandboxSelection = (reservation: ReviewSandboxOrder) => {
  const { interval, seats } = Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ entryTier, date }) => ({
        interval: getCoworkReservationInterval(entryTier, date),
        seats: 1,
      }),
      "meeting-room": ({ startsAt, endsAt }) => ({
        interval: { startsAt, endsAt },
        seats: 1,
      }),
      office: (office) => ({
        interval: getOfficeReservationIntervalInput(office),
        seats: office.seats,
      }),
    })
  );
  return {
    reservationDetails: getStoredWorkspaceReservationDetails(reservation),
    startsAt: Temporal.Instant.from(interval.startsAt),
    endsAt: Temporal.Instant.from(interval.endsAt),
    seats,
  };
};

const toSandboxReservation = (
  hold: ReviewAccountHold,
  now: Temporal.Instant
): ReviewSandboxReservation => ({
  orderId: hold.id,
  details: hold.reservationDetails,
  startsAt: hold.startsAt,
  endsAt: hold.endsAt,
  seats: hold.seats,
  total: {
    value: hold.totalValue,
    exponent: hold.totalExponent,
    currency: hold.currency,
  },
  state: getHoldState(hold, now),
});

const getHoldState = (
  hold: ReviewAccountHold,
  now: Temporal.Instant
): ReviewSandboxReservation["state"] => {
  if (hold.cancelledAt) return "cancelled";
  return Temporal.Instant.compare(hold.expiresAt, now) <= 0
    ? "expired"
    : "open";
};
