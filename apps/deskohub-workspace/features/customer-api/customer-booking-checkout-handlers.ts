import "server-only";

import {
  type CreateCustomerCheckout,
  CurrentCustomerSession,
  CustomerAccountLinkRequired,
  CustomerBookingSelectionInvalid,
  type CustomerCheckout,
  CustomerCheckoutDetailsInvalid,
  type CustomerCheckoutDiscountCodeResult,
  CustomerCheckoutNotFound,
  type CustomerCheckoutReturnTarget,
  type CustomerCheckoutStart,
  type CustomerCheckoutSubmission,
  CustomerCheckoutUnavailable,
  CustomerConsentRequired,
  CustomerDiscountCodeRejected,
  CustomerLegalDocumentsChanged,
  CustomerOfferingUnavailable,
  CustomerQuoteExpired,
  CustomerSelectionUnavailable,
  customerReferralCodeHeader,
  type SubmitCustomerCheckout,
} from "@deskohub/workspace-customer-api";
import {
  Cause,
  type Duration,
  Effect,
  Layer,
  Match,
  Predicate,
  Schema,
  type SchemaIssue,
} from "effect";
import type { HttpApiBuilder } from "effect/unstable/httpapi";
import { env } from "@/env";
import { getApplyDiscountCodeDeadline } from "@/features/checkout/actions/apply-discount-code-to-pay-state";
import {
  CheckoutService,
  getPaymentReturnDestination,
  getPayStateCheckoutView,
  type PayStateTokenError,
} from "@/features/checkout/backend/checkout";
import { getCheckoutSubmitDeadline } from "@/features/checkout/backend/checkout/checkout-submit-deadline";
import type { SignedPayState } from "@/features/checkout/backend/checkout/pay-state";
import type { Locale } from "@/features/i18n";
import { isCurrentPaymentSubmitLegalAcceptance } from "@/features/legal/payment-submit-evidence";
import { preparePayStateInputSchema } from "@/features/reservation/actions/prepare-pay-state.schema";
import { getPreparePayStateDeadline } from "@/features/reservation/actions/prepare-pay-state-deadline";
import {
  type QuoteSelection,
  resolveBookingQuoteSelection,
} from "@/features/reservation/backend/booking-selection";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { providePerRequest } from "@/shared/backend/provide-per-request";
import { getFirstInvalidFieldPath } from "@/shared/utils/schema-issue";
import { currentInstant } from "@/shared/utils/temporal";
import {
  answerCustomerApiFailure,
  answerUnavailable,
} from "./customer-api-failure";
import { CustomerBookingCheckoutLayers } from "./customer-booking-checkout-layers";
import type { CustomerBookingEndpoint } from "./customer-booking-endpoint";
import {
  answerBookingSelectionFailure,
  toBookingSelectionInput,
} from "./customer-booking-selection";
import {
  CheckoutServicesUnavailable,
  CustomerCheckoutOperations,
} from "./customer-checkout-operations.service";
import { CustomerReferralUpdates } from "./customer-referral-updates";

type Operations = CustomerCheckoutOperations["Service"];
type PreparationResult = Effect.Success<
  ReturnType<Operations["preparePayState"]>
>;
type PreparationFailure = Effect.Error<
  ReturnType<Operations["preparePayState"]>
>;
type DiscountCodeResult = Effect.Success<
  ReturnType<Operations["applyDiscountCode"]>
>;
type DiscountCodeFailure = Effect.Error<
  ReturnType<Operations["applyDiscountCode"]>
>;
type AuthorFailure = Effect.Error<ReturnType<Operations["requireAuthor"]>>;
type CheckoutSubmission = Effect.Success<
  ReturnType<CheckoutService["Service"]["createHostedPaymentCheckout"]>
>;
type CheckoutSubmissionFailure = Effect.Error<
  ReturnType<CheckoutService["Service"]["createHostedPaymentCheckout"]>
>;

/**
 * Attaches the booking checkout's handlers to the booking group's, leaving
 * the catalog's endpoints for `handleCustomerBookingCatalog`. They run the
 * same holds, discount codes, price reviews and payment submissions as the
 * site's Pay page, under the signed-in customer's session and only on the
 * customer's own orders. Each request builds its operations from
 * `CustomerBookingCheckoutLayers`, with its release gates decided once and
 * its referral code recorded for the response, and answers every failure
 * with a fixed public error.
 */
export const handleCustomerBookingCheckout = <R>(
  handlers: HttpApiBuilder.Handlers<R, CustomerBookingEndpoint>
) =>
  Effect.gen(function* () {
    const { operations, checkout, inventory, releases } =
      yield* CustomerBookingCheckoutLayers;

    /**
     * One request's services: its release gates, decided once and shared
     * by the selection, the operations and the referral record, which the
     * operations close over.
     */
    const forRequest = <A, E, R>(
      referralCode: string | undefined,
      services: Layer.Layer<A, E, R>
    ) =>
      Layer.mergeAll(operations, inventory, services).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            CustomerReferralUpdates.fromClient(referralCode),
            releases.referral,
            releases.office
          )
        )
      );

    return handlers
      .handle("createCheckout", ({ payload, headers }) =>
        createCheckout(payload).pipe(
          providePerRequest(
            forRequest(headers[customerReferralCodeHeader], Layer.empty)
          ),
          withDeadline(
            "customerApi.createCheckout",
            getPreparePayStateDeadline(env.VERCEL_ENV)
          )
        )
      )
      .handle("applyCheckoutDiscountCode", ({ payload, headers }) =>
        applyDiscountCode(payload).pipe(
          providePerRequest(
            forRequest(headers[customerReferralCodeHeader], Layer.empty)
          ),
          withDeadline(
            "customerApi.applyCheckoutDiscountCode",
            getApplyDiscountCodeDeadline(env.VERCEL_ENV)
          )
        )
      )
      .handle("acceptCheckoutPriceChange", ({ payload }) =>
        acceptPriceChange(payload).pipe(
          providePerRequest(forRequest(undefined, Layer.empty))
        )
      )
      .handle("submitCheckout", ({ payload, headers }) =>
        submitCheckout(payload).pipe(
          providePerRequest(
            forRequest(
              headers[customerReferralCodeHeader],
              CheckoutServicesUnavailable.whenUnbuilt(checkout)
            )
          ),
          Effect.catchTag(
            "CheckoutServicesUnavailable",
            retryable("customerApi.submitCheckout")
          ),
          withDeadline(
            "customerApi.submitCheckout",
            getCheckoutSubmitDeadline(env.VERCEL_ENV)
          )
        )
      );
  });

// createCheckout

/**
 * Holds a quoted selection the way the agent tools' `start_reservation`
 * does: resolved as the booking pages accept it, decoded into the booking
 * form's input, and prepared with the site's services.
 */
const createCheckout = Effect.fn("customerApi.createCheckout")(function* (
  payload: CreateCustomerCheckout
) {
  const operation = "customerApi.createCheckout";
  const now = yield* currentInstant;
  const selection = yield* toBookingSelectionInput(payload.selection).pipe(
    Effect.flatMap((input) =>
      resolveBookingQuoteSelection({
        selection: input,
        locale: payload.locale,
        now,
      })
    ),
    answerBookingSelectionFailure(operation)
  );
  const reservation = yield* withEarlySetup(selection, payload.earlySetup);
  const input = yield* toPreparationInput(payload, reservation);
  const operations = yield* CustomerCheckoutOperations;
  const prepared = yield* operations
    .preparePayState(input)
    .pipe(Effect.catch(answerPreparationFailure(operation)));

  return yield* toCheckoutStart(prepared);
});

/**
 * Adds the early setup a meeting-room booking asked for, at no cost, as
 * `start_reservation` does. Other families offer none.
 */
const withEarlySetup = (
  selection: QuoteSelection,
  earlySetup: boolean | undefined
): Effect.Effect<
  QuoteSelection["reservation"],
  CustomerBookingSelectionInvalid
> => {
  if (earlySetup !== true) return Effect.succeed(selection.reservation);
  return selection.reservation.kind === "meeting-room"
    ? Effect.succeed({ ...selection.reservation, earlySetup: true })
    : Effect.fail(new CustomerBookingSelectionInvalid({ field: "earlySetup" }));
};

/**
 * The booking form's input for the checkout: the account's own booking
 * books as its linked customer, a booking for someone else as the submitted
 * contact. A grant of marketing consent is labeled with the app's channel;
 * the client can't name one.
 */
const toPreparationInput = (
  payload: CreateCustomerCheckout,
  reservation: QuoteSelection["reservation"]
) =>
  Schema.decodeEffect(preparePayStateInputSchema)({
    locale: payload.locale,
    checkoutSessionId: payload.checkoutSessionId,
    checkoutAttemptId: payload.checkoutAttemptId,
    advertisedPriceToken: payload.advertisedPriceToken,
    ...(payload.marketingConsent === true && { marketingConsent: true }),
    ...(payload.bookingFor === "self" && { customer: "account" }),
    reservation: {
      ...reservation,
      name: payload.contact.name,
      email: payload.contact.email,
      phone: payload.contact.phone,
      billing: payload.billing,
    },
  }).pipe(
    Effect.map((decoded): Parameters<Operations["preparePayState"]>[0] =>
      decoded.marketingConsent === true
        ? { ...decoded, marketingConsentSource: "customer_app" }
        : decoded
    ),
    Effect.mapError(
      (error) =>
        new CustomerCheckoutDetailsInvalid(toCheckoutDetailsField(error.issue))
    )
  );

/**
 * The contract field a decode issue names: the booking form keeps the
 * contact on the reservation and the billing below it. The server resolved
 * the selection itself, so an issue elsewhere names no field.
 */
const toCheckoutDetailsField = (issue: SchemaIssue.Issue) => {
  const path = getFirstInvalidFieldPath(issue);
  const [root, field, ...rest] = path?.split(".") ?? [];
  if (root !== "reservation" || field === undefined) return {};
  if (field === "name" || field === "email" || field === "phone") {
    return { field: `contact.${field}` };
  }
  if (field === "billing") {
    return { field: ["billing", ...rest].join(".") };
  }
  return {};
};

const answerPreparationFailure =
  (operation: string) => (failure: PreparationFailure) =>
    Match.value(failure).pipe(
      Match.tagsExhaustive({
        CustomerAccountAccessError: (accessFailure) =>
          Effect.fail(accessFailure).pipe(answerCustomerApiFailure(operation)),
        AdvertisedPriceMismatchError: () =>
          Effect.fail(new CustomerQuoteExpired()),
        // Preparation seals the checkout it starts; the client sent no
        // checkout token, so this is the server's failure.
        PayStateTokenError: (tokenFailure) =>
          unavailable(operation, tokenFailure),
        CheckoutAttemptUnavailableError: () =>
          Effect.fail(
            new CustomerSelectionUnavailable({ reason: "checkout_conflict" })
          ),
        AgentBookingPaymentInProgressError: () =>
          Effect.fail(
            new CustomerSelectionUnavailable({ reason: "checkout_conflict" })
          ),
        AgentBookingProfileRequiredError: () =>
          Effect.fail(
            new CustomerAccountLinkRequired({ reason: "profile-missing" })
          ),
        WorkspaceTableUnavailableError: () =>
          Effect.fail(
            new CustomerSelectionUnavailable({ reason: "availability_changed" })
          ),
        TableAssignmentUnavailableError: () =>
          Effect.fail(
            new CustomerSelectionUnavailable({ reason: "availability_changed" })
          ),
        OfficeReservationsDisabledError: () =>
          Effect.fail(new CustomerOfferingUnavailable({ family: "office" })),
        ReservationIntervalValidationError: () =>
          Effect.fail(new CustomerBookingSelectionInvalid({})),
        UndeliverableContactEmailError: () =>
          Effect.fail(
            new CustomerCheckoutDetailsInvalid({ field: "contact.email" })
          ),
        // An unknown or unreadable discount is retried, never answered as a
        // changed price.
        PromotionCodeUnavailableError: retryable(operation),
        DiscountProviderError: retryable(operation),
        DiscountAffirmationUnavailableError: retryable(operation),
        DiscountCalculationError: retryable(operation),
        MoneyUnitMismatch: retryable(operation),
        EffectDrizzleQueryError: retryable(operation),
        SqlError: retryable(operation),
        DotyposUnavailable: retryable(operation),
        DotyposRejected: retryable(operation),
        DotyposUncertain: retryable(operation),
        MissingDotyposId: retryable(operation),
        WorkspaceReservationDetailsMalformedError: retryable(operation),
        WorkspaceReservationStateError: retryable(operation),
        AvailabilityQueryInvalid: retryable(operation),
        GoogleCalendarAPIError: retryable(operation),
        GoogleCalendarConfigError: retryable(operation),
        SharedSnapshotLoadFailure: retryable(operation),
        InvalidDotyposTableSeats: retryable(operation),
        TableAssignmentUnconfigured: retryable(operation),
        MarketingConsentUnavailable: retryable(operation),
        CheckoutServicesUnavailable: retryable(operation),
      })
    );

/**
 * The checkout a preparation started: a review account's hold has no
 * checkout to continue, a conflicting submission holds the selection, and
 * any other hold answers its signed state.
 */
const toCheckoutStart = (
  prepared: PreparationResult
): Effect.Effect<
  CustomerCheckoutStart,
  CustomerSelectionUnavailable | CustomerServiceUnavailableAnswer,
  CustomerCheckoutOperations | CustomerReferralUpdates
> =>
  Match.value(prepared).pipe(
    Match.discriminatorsExhaustive("status")({
      error: () =>
        Effect.fail(
          new CustomerSelectionUnavailable({ reason: "checkout_conflict" })
        ),
      ready: (ready) =>
        "reviewSandbox" in ready
          ? Effect.succeed({
              status: "payment_disabled" as const,
              orderId: ready.orderId,
            })
          : checkoutAt(ready.payStateToken, {
              referralApplied: ready.referralApplied,
            }),
      pricing_changed: (changed) =>
        checkoutAt(changed.payStateToken, {
          referralApplied: changed.referralApplied,
        }),
    })
  );

// applyCheckoutDiscountCode

const applyDiscountCode = Effect.fn("customerApi.applyCheckoutDiscountCode")(
  function* (payload: {
    readonly locale: Locale;
    readonly payStateToken: string;
    readonly code: string;
  }) {
    const operation = "customerApi.applyCheckoutDiscountCode";
    yield* requireAuthor(operation, payload);
    const operations = yield* CustomerCheckoutOperations;
    const result = yield* operations
      .applyDiscountCode({
        locale: payload.locale,
        payStateToken: payload.payStateToken,
        submittedCode: payload.code,
      })
      .pipe(Effect.catch(answerDiscountCodeFailure(operation)));

    return yield* toDiscountCodeAnswer(operation, result);
  }
);

/** The checkout after a code, or why the code wasn't applied. */
const toDiscountCodeAnswer = (
  operation: string,
  result: DiscountCodeResult
): Effect.Effect<
  CustomerCheckoutDiscountCodeResult,
  | CustomerDiscountCodeRejected
  | CustomerCheckoutUnavailable
  | CustomerServiceUnavailableAnswer,
  CustomerCheckoutOperations | CustomerReferralUpdates
> =>
  Match.value(result).pipe(
    Match.discriminatorsExhaustive("status")({
      applied: (applied) =>
        checkoutAt(applied.freshPayStateToken).pipe(
          Effect.map((view) => ({ ...view, discountCode: "applied" as const }))
        ),
      accepted: (accepted) =>
        checkoutAt(accepted.freshPayStateToken).pipe(
          Effect.map((view) => ({
            ...view,
            discountCode: "referral_accepted" as const,
          }))
        ),
      already_accepted: (accepted) =>
        checkoutAt(accepted.freshPayStateToken).pipe(
          Effect.map((view) => ({
            ...view,
            discountCode: "referral_accepted" as const,
          }))
        ),
      pricing_changed: (changed) => checkoutAt(changed.freshPayStateToken),
      already_attributed: (rejected) =>
        Effect.fail(codeRejected("already_attributed", rejected)),
      ineligible: (rejected) =>
        Effect.fail(codeRejected("ineligible", rejected)),
      unavailable: (unavailable) =>
        Match.value(unavailable).pipe(
          Match.discriminatorsExhaustive("reason")({
            code: (rejected) =>
              Effect.fail(codeRejected("unavailable", rejected)),
            code_already_applied: (rejected) =>
              Effect.fail(codeRejected("code_already_applied", rejected)),
            provider: () =>
              answerUnavailable(operation, { failure: "discount-provider" }),
            price_review_pending: () =>
              Effect.fail(
                new CustomerCheckoutUnavailable({
                  reason: "price_review_pending",
                })
              ),
            checkout: ({ checkoutReason }) =>
              Effect.fail(
                new CustomerCheckoutUnavailable({
                  reason: toCheckoutUnavailableReason(checkoutReason),
                })
              ),
          })
        ),
    })
  );

/** The replacement checkout a rejection signed, when it signed one. */
const codeRejected = (
  reason: CustomerDiscountCodeRejected["reason"],
  rejected: {
    readonly freshPayStateToken?: string;
    readonly expiresAt?: string;
  }
) =>
  new CustomerDiscountCodeRejected({
    reason,
    ...(rejected.freshPayStateToken !== undefined &&
      rejected.expiresAt !== undefined && {
        payStateToken: rejected.freshPayStateToken,
        expiresAt: rejected.expiresAt,
      }),
  });

const toCheckoutUnavailableReason = (
  checkoutReason: Extract<
    DiscountCodeResult,
    { readonly reason: "checkout" }
  >["checkoutReason"]
): CustomerCheckoutUnavailable["reason"] =>
  Match.value(checkoutReason).pipe(
    Match.when("payment_in_progress", () => "payment_in_progress" as const),
    Match.when("expired", () => "expired" as const),
    Match.orElse(() => "not_payable" as const)
  );

const answerDiscountCodeFailure =
  (operation: string) => (failure: DiscountCodeFailure) =>
    Match.value(failure).pipe(
      Match.tagsExhaustive({
        PayStateTokenError: answerTokenFailure(operation),
        SealedStateTokenError: retryable(operation),
        // Signing the replacement checkout failed, not the client's token.
        PayStateIssueError: retryable(operation),
        MoneyUnitMismatch: retryable(operation),
        DiscountCalculationError: retryable(operation),
        EffectDrizzleQueryError: retryable(operation),
        DotyposUnavailable: retryable(operation),
        DotyposRejected: retryable(operation),
        WorkspaceReservationDetailsMalformedError: retryable(operation),
        CheckoutServicesUnavailable: retryable(operation),
      })
    );

// acceptCheckoutPriceChange

const acceptPriceChange = Effect.fn("customerApi.acceptCheckoutPriceChange")(
  function* (payload: {
    readonly locale: Locale;
    readonly payStateToken: string;
  }) {
    const operation = "customerApi.acceptCheckoutPriceChange";
    yield* requireAuthor(operation, payload);
    const operations = yield* CustomerCheckoutOperations;
    const accepted = yield* operations.acceptPriceChange(payload).pipe(
      Effect.catchTags({
        PayStateTokenError: answerTokenFailure(operation),
        PayStateIssueError: retryable(operation),
        CheckoutServicesUnavailable: retryable(operation),
      })
    );

    return yield* checkoutAt(accepted.payStateToken);
  }
);

// submitCheckout

/**
 * Submits a checkout the way the site's Pay page does, after checking the
 * consents the client sent against the legal documents in force.
 */
const submitCheckout = Effect.fn("customerApi.submitCheckout")(function* (
  payload: typeof SubmitCustomerCheckout.Type
) {
  const operation = "customerApi.submitCheckout";
  yield* requireAuthor(operation, payload);
  if (payload.legalConsent !== true) {
    return yield* new CustomerConsentRequired({ consent: "legal" });
  }
  if (
    !isCurrentPaymentSubmitLegalAcceptance(
      payload.locale,
      payload.acceptedLegalDocuments
    )
  ) {
    return yield* new CustomerLegalDocumentsChanged();
  }

  const submission = yield* CheckoutService.pipe(
    Effect.flatMap((checkout) =>
      checkout.createHostedPaymentCheckout(
        {
          payStateToken: payload.payStateToken,
          legalConsent: payload.legalConsent,
          ...(payload.earlyPerformanceConsent !== undefined && {
            earlyPerformanceConsent: payload.earlyPerformanceConsent,
          }),
          ...(payload.returnTarget !== undefined && {
            returnTarget: payload.returnTarget,
          }),
        },
        payload.locale
      )
    ),
    Effect.catchTag("CheckoutError", answerSubmissionFailure(operation))
  );

  return yield* toSubmissionAnswer(operation, submission, payload.returnTarget);
});

const toSubmissionAnswer = (
  operation: string,
  submission: CheckoutSubmission,
  returnTarget: CustomerCheckoutReturnTarget | undefined
): Effect.Effect<
  CustomerCheckoutSubmission,
  CustomerCheckoutUnavailable | CustomerServiceUnavailableAnswer,
  CustomerCheckoutOperations | CustomerReferralUpdates
> =>
  Match.value(submission).pipe(
    Match.discriminatorsExhaustive("status")({
      redirect: (redirect) =>
        toRedirectAnswer(operation, redirect, returnTarget),
      pricing_changed: (changed) => checkoutAt(changed.freshPayStateToken),
      // A payment underway, or a hold that's no longer payable: the status
      // screen tells which.
      in_progress: () =>
        Effect.fail(new CustomerCheckoutUnavailable({ reason: "not_payable" })),
    })
  );

/**
 * A submission that left nothing to pay, or the payment gateway to open,
 * with absolute links: the client isn't on the Workspace site. An app's
 * `returnTarget` makes `statusUrl` the app screen the payment's return
 * redirects to.
 */
const toRedirectAnswer = Effect.fn("customerApi.submitCheckout.redirect")(
  function* (
    operation: string,
    redirect: Extract<CheckoutSubmission, { readonly status: "redirect" }>,
    returnTarget: CustomerCheckoutReturnTarget | undefined
  ) {
    const origin = yield* getWorkspaceRuntimeCallbackOrigin.pipe(
      Effect.catch(retryable(operation))
    );
    const toStatusUrl = (sitePath: string) =>
      returnTarget === undefined
        ? Effect.succeed(new URL(sitePath, origin).toString())
        : getPaymentReturnDestination({
            target: returnTarget,
            orderId: redirect.orderId,
          }).pipe(Effect.catch(retryable(operation)));
    if (redirect.paid === true) {
      const operations = yield* CustomerCheckoutOperations;
      yield* operations
        .forgetReferralIfSettled({ kind: "order", paid: true })
        .pipe(Effect.catch(retryable(operation)));
      const { rememberedReferralCodeUsed } =
        yield* CustomerReferralUpdates.pipe(
          Effect.flatMap((updates) => updates.recorded)
        );
      return {
        status: "paid" as const,
        orderId: redirect.orderId,
        statusUrl: yield* toStatusUrl(redirect.redirectUrl),
        ...(rememberedReferralCodeUsed && { rememberedReferralCodeUsed }),
      };
    }
    if (redirect.statusUrl === undefined) {
      return yield* answerUnavailable(operation, {
        failure: "status-url-missing",
      });
    }
    return {
      status: "payment_required" as const,
      orderId: redirect.orderId,
      paymentUrl: redirect.redirectUrl,
      statusUrl: yield* toStatusUrl(redirect.statusUrl),
    };
  }
);

const answerSubmissionFailure =
  (operation: string) => (failure: CheckoutSubmissionFailure) =>
    Match.value(failure.code).pipe(
      Match.when("legal_consent_required", () =>
        Effect.fail(new CustomerConsentRequired({ consent: "legal" }))
      ),
      Match.when("early_performance_consent_required", () =>
        Effect.fail(
          new CustomerConsentRequired({ consent: "early_performance" })
        )
      ),
      Match.whenOr(
        "meeting_room_reservation_ended",
        "office_reservation_ended",
        "cowork_reservation_ended",
        () => reservationEnded
      ),
      Match.when("cowork_offer_replaced", () =>
        Effect.fail(
          new CustomerCheckoutUnavailable({ reason: "offer_replaced" })
        )
      ),
      Match.when("checkout_failed", () =>
        Predicate.isTagged(failure.cause, "WorkspaceTableUnavailableError")
          ? Effect.fail(
              new CustomerSelectionUnavailable({
                reason: "availability_changed",
              })
            )
          : answerUnavailable(operation, { failure: "checkout_failed" })
      ),
      Match.exhaustive
    );

const reservationEnded = Effect.fail(
  new CustomerCheckoutUnavailable({ reason: "reservation_ended" })
);

// Shared steps

/**
 * Lets the step continue only on the signed-in customer's own order; any
 * other order is not found, whether or not it exists.
 */
const requireAuthor = Effect.fn("customerApi.requireCheckoutAuthor")(function* (
  operation: string,
  payload: { readonly locale: Locale; readonly payStateToken: string }
) {
  const session = yield* CurrentCustomerSession;
  const operations = yield* CustomerCheckoutOperations;
  return yield* operations
    .requireAuthor({ ...payload, accountId: session.accountId })
    .pipe(Effect.catch(answerAuthorFailure(operation)));
});

const answerAuthorFailure = (operation: string) => (failure: AuthorFailure) =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      PayStateAuthorNotFoundError: () =>
        Effect.fail(new CustomerCheckoutNotFound()),
      PayStateTokenError: answerTokenFailure(operation),
      EffectDrizzleQueryError: retryable(operation),
      WorkspaceReservationDetailsMalformedError: retryable(operation),
      CheckoutServicesUnavailable: retryable(operation),
    })
  );

/**
 * The checkout a token the server just issued describes, with what the
 * request changed about the client's referral code.
 */
const checkoutAt = (
  payStateToken: string,
  facts: { readonly referralApplied?: true } = {}
): Effect.Effect<
  CustomerCheckout,
  CustomerServiceUnavailableAnswer,
  CustomerCheckoutOperations | CustomerReferralUpdates
> =>
  Effect.gen(function* () {
    const operations = yield* CustomerCheckoutOperations;
    const state = yield* operations
      .readPayState(payStateToken)
      .pipe(Effect.catch(retryable("customerApi.readPayState")));
    const referral = yield* CustomerReferralUpdates.pipe(
      Effect.flatMap((updates) => updates.recorded)
    );

    return toCustomerCheckout(state, yield* currentInstant, payStateToken, {
      ...facts,
      ...referral,
    });
  });

const toCustomerCheckout = (
  state: SignedPayState,
  now: Temporal.Instant,
  payStateToken: string,
  facts: Pick<
    CustomerCheckout,
    "referralApplied" | "rememberReferralCode" | "rememberedReferralCodeUsed"
  >
): CustomerCheckout => {
  const view = getPayStateCheckoutView(state, now);
  return {
    status: view.changedKeys === undefined ? "ready" : "price_review",
    orderId: view.orderId,
    payStateToken,
    expiresAt: view.expiresAt,
    summary: view.summary,
    ...(view.changedKeys !== undefined && {
      priceReview: { changedKeys: view.changedKeys },
    }),
    earlyPerformanceConsent: view.earlyPerformanceConsent,
    ...(facts.referralApplied && { referralApplied: true }),
    ...(facts.rememberReferralCode !== undefined && {
      rememberReferralCode: facts.rememberReferralCode,
    }),
    ...(facts.rememberedReferralCodeUsed && {
      rememberedReferralCodeUsed: true,
    }),
  };
};

/**
 * A token the client can't use any more starts a new checkout; keys that
 * can't seal or open any token are unavailable.
 */
const answerTokenFailure =
  (operation: string) => (failure: PayStateTokenError) =>
    isSealingConfigurationFailure(failure)
      ? unavailable(operation, failure)
      : Effect.fail(new CustomerCheckoutUnavailable({ reason: "expired" }));

const isSealingConfigurationFailure = (failure: PayStateTokenError) =>
  failure.code === "missing-secret" || failure.code === "invalid-secret";

type CustomerServiceUnavailableAnswer = Effect.Error<
  ReturnType<typeof answerUnavailable>
>;

const unavailable = (
  operation: string,
  failure: { readonly _tag: string; readonly code?: string }
) =>
  answerUnavailable(operation, {
    failure: failure._tag,
    ...(failure.code !== undefined && { code: failure.code }),
  });

/** A failure the client can only retry, logged by its tag. */
const retryable = (operation: string) => (failure: { readonly _tag: string }) =>
  answerUnavailable(operation, { failure: failure._tag });

/**
 * Bounds a mutation by the deadline its site action has; one that runs out
 * is unavailable.
 */
const withDeadline =
  (operation: string, deadline: Duration.Duration) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.timeout(deadline),
      Effect.catchIf(Cause.isTimeoutError, () =>
        answerUnavailable(operation, { failure: "timeout" })
      )
    );
