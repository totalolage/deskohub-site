import {
  type CustomerCheckoutReturnTarget,
  type CustomerRateLimited,
  type CustomerRequestRejected,
  type CustomerSessionRequired,
  customerReferralCodeHeader,
  type ReferralCode,
} from "@deskohub/workspace-customer-api";
import { Effect, Match, Option, type Schema } from "effect";
import type { HttpClientError } from "effect/unstable/http";
import { Platform, type PlatformOSType } from "react-native";
import { trackBookingSubmitted } from "../../analytics/events";
import { CustomerApi } from "../../customer-api/customer-api.service";
import type { CustomerDataServices } from "../../customer-api/customer-data-runtime";
import {
  type CustomerRequestTimedOut,
  type CustomerWriteUnconfirmed,
  customerRead,
  customerWrite,
} from "../../customer-api/customer-request";
import type { BookingServices } from "../data/booking-services-layer";
import { PaymentBrowser } from "../payment-browser.service";
import { RememberedReferralCode } from "../remembered-referral.service";
import { reservationKindOf } from "../selection/booking-selection";
import {
  BookingProblem,
  bookingProblem,
  type CheckoutFailure,
  CustomerRequestFailure,
} from "./booking-problem";
import {
  type AcceptPriceChangeCommand,
  type ApplyDiscountCodeCommand,
  CheckoutCommand,
  CheckoutEvent,
  type CheckoutOperationId,
  type CreateCheckoutCommand,
  type OpenPaymentCommand,
  type SubmitCheckoutCommand,
} from "./checkout-state";

/**
 * The checkout's command interpreter: runs one command the machine asked
 * for and answers with the event `step` takes next. Every request goes
 * through the account's customer API conventions (`customerRead` /
 * `customerWrite`); every failure becomes `CommandFailed` with its
 * `BookingProblem`, so this never fails. Side effects nobody waits on (the
 * remembered referral code, analytics) answer with no event; a fault in one
 * is logged and dropped.
 */
export const runCheckoutCommand = (
  command: CheckoutCommand
): Effect.Effect<
  Option.Option<CheckoutEvent>,
  never,
  CustomerDataServices | BookingServices
> =>
  CheckoutCommand.$match(command, {
    CreateCheckout: createCheckout,
    LoadLegalDocuments: ({ operationId, locale }) =>
      bookingApi.pipe(
        Effect.flatMap((booking) =>
          booking.listLegalDocuments({ query: { locale } })
        ),
        customerRead({ accountRead: false }),
        Effect.map(({ documents }) =>
          CheckoutEvent.LegalDocumentsLoaded({ operationId, documents })
        ),
        answerOf(operationId)
      ),
    ApplyDiscountCode: applyDiscountCode,
    AcceptPriceChange: acceptPriceChange,
    SubmitCheckout: submitCheckout,
    OpenPayment: openPayment,
    UpdateRememberedReferral: ({ update }) =>
      Effect.flatMap(Effect.service(RememberedReferralCode), (remembered) =>
        remembered.apply(update)
      ).pipe(answerless("UpdateRememberedReferral")),
    TrackBookingSubmitted: ({ family }) =>
      Effect.sync(() => trackBookingSubmitted(reservationKindOf(family))).pipe(
        answerless("TrackBookingSubmitted")
      ),
  });

/**
 * Whether the machine waits for the command's answer. A step's side
 * effects start before its requests: on web, opening the payment page
 * leaves the app, so the submission is reported first.
 */
export const isSideEffect = (command: CheckoutCommand): boolean =>
  CheckoutCommand.$is("UpdateRememberedReferral")(command) ||
  CheckoutCommand.$is("TrackBookingSubmitted")(command);

/**
 * Where the payment returns the customer: the app's own status screen, as
 * a deep link on Android and iOS or the web app's page on web.
 */
export const checkoutReturnTarget = (
  os: PlatformOSType
): CustomerCheckoutReturnTarget =>
  Match.value(os).pipe(
    Match.when("web", () => "web-app" as const),
    Match.orElse(() => "native-app" as const)
  );

const bookingApi = Effect.map(
  Effect.service(CustomerApi),
  (api) => api.booking
);

const createCheckout = ({
  operationId,
  request,
  referralCode,
}: CreateCheckoutCommand) =>
  bookingApi.pipe(
    Effect.flatMap((booking) =>
      booking.createCheckout({
        payload: request,
        headers: referralHeaders(referralCode),
      })
    ),
    customerWrite,
    Effect.map((start) =>
      CheckoutEvent.CheckoutCreated({ operationId, start })
    ),
    answerOf(operationId)
  );

const applyDiscountCode = ({
  operationId,
  request,
  referralCode,
}: ApplyDiscountCodeCommand) =>
  bookingApi.pipe(
    Effect.flatMap((booking) =>
      booking.applyCheckoutDiscountCode({
        payload: request,
        headers: referralHeaders(referralCode),
      })
    ),
    customerWrite,
    Effect.map((result) => CheckoutEvent.CodeApplied({ operationId, result })),
    answerOf(operationId)
  );

const acceptPriceChange = ({
  operationId,
  request,
}: AcceptPriceChangeCommand) =>
  bookingApi.pipe(
    Effect.flatMap((booking) =>
      booking.acceptCheckoutPriceChange({ payload: request })
    ),
    customerWrite,
    Effect.map((checkout) =>
      CheckoutEvent.PriceAccepted({ operationId, checkout })
    ),
    answerOf(operationId)
  );

/**
 * Submits with the platform's return target, so the payment comes back to
 * the app. The target is the platform's, so a resent submit stays identical.
 */
const submitCheckout = ({
  operationId,
  request,
  referralCode,
}: SubmitCheckoutCommand) =>
  Effect.Do.pipe(
    Effect.let("payload", () => ({
      ...request,
      returnTarget: checkoutReturnTarget(Platform.OS),
    })),
    Effect.bind("booking", () => bookingApi),
    Effect.bind("submission", ({ booking, payload }) =>
      booking
        .submitCheckout({ payload, headers: referralHeaders(referralCode) })
        .pipe(customerWrite)
    ),
    Effect.map(({ submission }) =>
      CheckoutEvent.Submitted({ operationId, submission })
    ),
    answerOf(operationId)
  );

const openPayment = ({
  operationId,
  paymentUrl,
  returnUrl,
}: OpenPaymentCommand) =>
  Effect.flatMap(Effect.service(PaymentBrowser), (browser) =>
    browser.open(paymentUrl, returnUrl)
  ).pipe(
    Effect.map((result) => CheckoutEvent.PaymentEnded({ operationId, result })),
    answerOf(operationId)
  );

/** The remembered referral code, as the booking endpoints take it. */
const referralHeaders = (code: Option.Option<ReferralCode>) =>
  Option.match(code, {
    onNone: () => ({}),
    onSome: (sent) => ({ [customerReferralCodeHeader]: sent }),
  });

/** A side effect answers nothing; its fault can't fail the checkout. */
const answerless =
  (command: CheckoutCommand["_tag"]) =>
  <R>(
    effect: Effect.Effect<void, never, R>
  ): Effect.Effect<Option.Option<CheckoutEvent>, never, R> =>
    effect.pipe(
      Effect.catchDefect((defect) =>
        Effect.logWarning(`Checkout side effect ${command} failed`, defect)
      ),
      Effect.as(Option.none())
    );

/**
 * The failures the customer API layer hands over besides the checkout's own:
 * sessions, budgets, transport, timeouts and lost answers.
 */
type SharedRequestFailure =
  | CustomerSessionRequired
  | CustomerRateLimited
  | CustomerRequestRejected
  | CustomerRequestTimedOut
  | CustomerWriteUnconfirmed
  | HttpClientError.HttpClientError
  | Schema.SchemaError;

/**
 * Answers a command with its event, or with `CommandFailed` for any typed
 * failure or defect. A defect is a fault in the app, so the customer can
 * only retry.
 */
const answerOf =
  (operationId: CheckoutOperationId) =>
  <R>(
    answered: Effect.Effect<
      CheckoutEvent,
      CheckoutFailure | SharedRequestFailure,
      R
    >
  ): Effect.Effect<Option.Option<CheckoutEvent>, never, R> =>
    answered.pipe(
      Effect.catch((failure) =>
        Effect.succeed(
          CheckoutEvent.CommandFailed({
            operationId,
            problem: bookingProblem(checkoutFailure(failure)),
          })
        )
      ),
      Effect.catchDefect(() =>
        Effect.succeed(
          CheckoutEvent.CommandFailed({
            operationId,
            problem: BookingProblem.Retryable({ kind: "unexpected" }),
          })
        )
      ),
      Effect.map(Option.some)
    );

/**
 * A command's failure as the checkout classifies it. A write that may have
 * applied is unconfirmed (`customerWrite` already told sent from unsent);
 * every other request failure proves nothing changed.
 */
const checkoutFailure = (
  failure: CheckoutFailure | SharedRequestFailure
): CheckoutFailure =>
  Match.value(failure).pipe(
    Match.tags({
      CustomerWriteUnconfirmed: () =>
        CustomerRequestFailure.RequestUnconfirmed(),
      CustomerSessionRequired: () =>
        CustomerRequestFailure.RequestSessionRequired(),
      CustomerRateLimited: () => CustomerRequestFailure.RequestRateLimited(),
      CustomerRequestRejected: () =>
        CustomerRequestFailure.RequestUnavailable(),
      CustomerRequestTimedOut: () =>
        CustomerRequestFailure.RequestUnavailable(),
      HttpClientError: () => CustomerRequestFailure.RequestUnavailable(),
      SchemaError: () => CustomerRequestFailure.RequestUnavailable(),
    }),
    Match.orElse((checkout) => checkout)
  );
