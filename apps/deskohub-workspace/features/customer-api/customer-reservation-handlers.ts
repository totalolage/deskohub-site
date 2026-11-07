import "server-only";

import {
  CurrentCustomerSession,
  CustomerAccessCodeUnavailable,
  CustomerAccountLinkRequired,
  type CustomerOrderState,
  type CustomerReservationAccess,
  type CustomerReservationHistory,
  CustomerReservationNotFound,
  type CustomerReservationSummary,
  CustomerSessionRequired,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Match } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  type CustomerReservationHistory as ReservationHistoryRecord,
  CustomerReservationHistoryService,
  type CustomerReservationSummary as ReservationSummaryRecord,
  currentReservationHistoryAccount,
} from "@/features/account";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { loadAuthorizedCheckoutStatus } from "@/features/checkout/backend/checkout/authorized-checkout-status";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout/checkout-status.service";
import { defaultLocale } from "@/features/i18n";
import {
  ReservationAccessService,
  type ReservationAccessViewModel,
} from "@/features/reservation/backend/reservation-access.service";
import { runToCompletion } from "@/shared/backend/run-to-completion";
import {
  answerCustomerApiFailure,
  answerSessionApiFailure,
  answerUnavailable,
} from "./customer-api-failure";
import { CustomerReservationLayers } from "./customer-reservation-layers";

/**
 * The customer API presents only the session, never an emailed capability
 * link, so authorization doesn't read the locale such a link was issued for.
 */
const capabilityLocale = defaultLocale;

/**
 * The reservations group's handlers. Each endpoint builds its operation's
 * Layers per request from `CustomerReservationLayers`, and answers every
 * failure with the contract's fixed public errors. An order the account may
 * not see is not found, exactly like one that doesn't exist.
 */
export const CustomerReservationsApiHandlers = HttpApiBuilder.group(
  WorkspaceCustomerApi,
  "reservations",
  Effect.fn(function* (handlers) {
    const reservations = yield* CustomerReservationLayers;
    // The authentication the session middleware read the request through.
    const authentication = Layer.succeed(
      CustomerAuthentication,
      yield* CustomerAuthentication
    );
    const authorization = reservations.authorization(authentication);

    return (
      handlers
        .handle("listReservations", () =>
          Effect.flatMap(CurrentCustomerSession, (session) =>
            currentReservationHistoryAccount(session.accountId)
          ).pipe(
            Effect.flatMap((account) =>
              Effect.flatMap(CustomerReservationHistoryService, (histories) =>
                histories.load(account)
              )
            ),
            Effect.provide(
              Layer.mergeAll(
                reservations.contacts(authentication),
                reservations.history
              )
            ),
            answerCustomerApiFailure("customerApi.listReservations"),
            Effect.flatMap(answerReservationHistory)
          )
        )
        // A refresh can finalize a payment, so it ends even when the client
        // disconnects.
        .handle("getReservationStatus", ({ params: { orderId } }) =>
          loadAuthorizedCheckoutStatus({
            orderId,
            locale: capabilityLocale,
            returnOutcome: "unknown",
          }).pipe(
            Effect.provide(
              Layer.mergeAll(reservations.checkoutStatus, authorization)
            ),
            runToCompletion,
            answerSessionApiFailure("customerApi.getReservationStatus"),
            Effect.flatMap(answerOrderState)
          )
        )
        // Showing a code can issue it at the lock provider and store it, so
        // it ends even when the client disconnects.
        .handle("getReservationAccess", ({ params: { orderId } }) =>
          Effect.flatMap(ReservationAccessService, (access) =>
            access.getAccess({ orderId, locale: capabilityLocale })
          ).pipe(
            Effect.provide(reservations.access(authorization)),
            runToCompletion,
            answerSessionApiFailure("customerApi.getReservationAccess"),
            Effect.flatMap(answerReservationAccess)
          )
        )
    );
  })
);

/**
 * The history the contract carries. Only the account page's account state
 * degrades a history to unavailable, so each reason answers as the account
 * failure it stands for.
 */
const answerReservationHistory = (history: ReservationHistoryRecord) =>
  Match.value(history).pipe(
    Match.discriminatorsExhaustive("kind")({
      available: ({ groups }) =>
        Effect.succeed<CustomerReservationHistory>({
          current: groups.current.map(answerReservationSummary),
          past: groups.past.map(answerReservationSummary),
          unavailable: groups.unavailable.map(answerReservationSummary),
        }),
      unavailable: ({ reason }) =>
        Match.value(reason).pipe(
          Match.when("provider-unavailable", () =>
            answerUnavailable("customerApi.listReservations", { reason })
          ),
          Match.when("link-required", () =>
            Effect.fail(
              new CustomerAccountLinkRequired({ reason: "profile-missing" })
            )
          ),
          Match.when("email-unverified", () =>
            Effect.fail(new CustomerSessionRequired())
          ),
          Match.exhaustive
        ),
    })
  );

/** A history entry as the contract carries it, without unknown fields. */
const answerReservationSummary = ({
  id,
  workspaceReservationId,
  reviewSandbox,
  party,
  product,
  startsAt,
  endsAt,
  setupStartsAt,
  seats,
  status,
}: ReservationSummaryRecord): CustomerReservationSummary => ({
  id,
  ...(workspaceReservationId && { orderId: workspaceReservationId }),
  ...(reviewSandbox && { reviewSandbox }),
  ...(party && { party }),
  product,
  startsAt,
  endsAt,
  ...(setupStartsAt && { setupStartsAt }),
  seats,
  status,
});

/** An order the account may see, as the contract carries its status. */
const answerOrderState = (state: CheckoutStatusViewModel) =>
  Match.value(state).pipe(
    Match.when({ status: "not_found" }, () =>
      Effect.fail(new CustomerReservationNotFound())
    ),
    Match.orElse(
      ({
        orderId,
        kind,
        status,
        paymentStatus,
        fulfillmentStatus,
        reviewSandbox,
        summary,
      }) =>
        Effect.succeed<CustomerOrderState>({
          orderId,
          kind,
          status,
          paymentStatus,
          fulfillmentStatus,
          ...(reviewSandbox && { reviewSandbox }),
          ...(summary && {
            startsAt: summary.reservedFrom.toString(),
            endsAt: summary.reservedUntil.toString(),
            ...("setupFrom" in summary &&
              summary.setupFrom && {
                setupStartsAt: summary.setupFrom.toString(),
              }),
            total: {
              value: summary.price.value,
              exponent: summary.price.exponent,
              currency: summary.price.currency,
            },
          }),
        })
    )
  );

/**
 * The door code, when the account may see it and the order has one. An
 * order whose code can't be read now, though it may have one, is
 * unavailable rather than without a code.
 */
const answerReservationAccess = (access: ReservationAccessViewModel) =>
  Match.value(access).pipe(
    Match.discriminatorsExhaustive("state")({
      available: ({ code, accessStartsAt, accessEndsAt }) =>
        Effect.succeed<CustomerReservationAccess>({
          code,
          accessStartsAt: accessStartsAt.toString(),
          accessEndsAt: accessEndsAt.toString(),
        }),
      invalid_link: () => Effect.fail(new CustomerReservationNotFound()),
      unavailable: ({ reason }) =>
        Match.value(reason).pipe(
          Match.when("reservation-state", () =>
            Effect.fail(new CustomerAccessCodeUnavailable())
          ),
          Match.when("lookup-failed", () =>
            answerUnavailable("customerApi.getReservationAccess", { reason })
          ),
          Match.exhaustive
        ),
    })
  );
