import type {
  CustomerCheckout,
  CustomerCheckoutDiscountCodeResult,
  CustomerCheckoutStart,
  CustomerCheckoutSubmission,
  CustomerLegalDocument,
} from "@deskohub/workspace-customer-api";
import { Match, Option } from "effect";
import { paymentReturnUrl } from "../payment-browser.service";
import {
  applyRememberedReferralUpdate,
  type RememberedReferralUpdate,
  rememberedReferralUpdate,
} from "../remembered-referral";
import { withoutAbsentOptions } from "../selection/booking-selection";
import {
  BookingProblem,
  type CheckoutReplacementToken,
  type CheckoutRetryKind,
} from "./booking-problem";
import {
  type CheckoutCommand,
  type CheckoutDetails,
  type CheckoutEvent,
  type CheckoutFlow,
  type CheckoutOperationId,
  type CheckoutStartInput,
  CheckoutState,
  type CheckoutStep,
  CodeStatus,
  CheckoutCommand as Command,
  type CreateCheckoutCommand,
  type CreatingState,
  DetailsNotice,
  type DetailsState,
  CheckoutEvent as Event,
  type HeldCheckout,
  LegalDocuments,
  type PayingState,
  type ReviewMutation,
  ReviewNotice,
  type ReviewState,
  type UncertainResume,
  type UncertainState,
} from "./checkout-state";

/**
 * The checkout as a pure state machine. `step` takes the current state and
 * one event and returns the next state with the commands to run; the
 * command interpreter runs them and sends their answers back as events.
 *
 * Rules, mirroring the booking pages:
 * - One write runs at a time: create, code, price acceptance, submit.
 * - Every checkout answer replaces the token, summary, expiry, price review
 *   and early-performance requirement together.
 * - Consent is bound to the loaded documents' versions and cleared whenever
 *   they change.
 * - A write whose answer was lost waits in `Uncertain` for an identical
 *   resend. A submit that may have executed never restarts the booking; the
 *   status screen reconciles it.
 */
export const startCheckout = (input: CheckoutStartInput): CheckoutState =>
  CheckoutState.Details({
    // Every request encodes the selection, and an option spelled out as
    // `undefined` can't be encoded.
    flow: {
      ...input,
      selection: withoutAbsentOptions(input.selection),
      nextOperationId: 1,
    },
    details: Option.none(),
    notice: Option.none(),
  });

export const step = (
  state: CheckoutState,
  event: CheckoutEvent
): CheckoutStep =>
  CheckoutState.$match(state, {
    Details: (details) => onDetails(details, event),
    Creating: (creating) => onCreating(creating, event),
    Review: (review) => onReview(review, event),
    Uncertain: (uncertain) => onUncertain(uncertain, event),
    Paying: (paying) => onPaying(paying, event),
    Done: stay,
    Restart: stay,
    Blocked: stay,
  });

/**
 * Whether Pay is enabled: no write runs, no changed price waits for
 * acceptance, and the checkbox accepted the loaded documents.
 */
export const canPay = (review: ReviewState): boolean =>
  Option.isNone(review.pending) &&
  Option.isNone(review.checkout.priceReview) &&
  LegalDocuments.$is("Loaded")(review.legal) &&
  Option.isSome(review.consent);

// Details

const onDetails = (details: DetailsState, event: CheckoutEvent) =>
  Event.$match(event, {
    Continue: ({ checkoutAttemptId, details: form }) =>
      create(details.flow, form, checkoutAttemptId),
    Retry: () =>
      Option.all({
        notice: details.notice.pipe(
          Option.filter(DetailsNotice.$is("Retryable"))
        ),
        form: details.details,
      }).pipe(
        Option.match({
          onNone: () => stay(details),
          onSome: ({ notice, form }) =>
            resendCreate(
              CheckoutState.Creating({
                flow: details.flow,
                details: form,
                command: notice.command,
              })
            ),
        })
      ),
    CodeChanged: () => stay(details),
    ApplyCode: () => stay(details),
    AcceptPrice: () => stay(details),
    ToggleConsent: () => stay(details),
    Pay: () => stay(details),
    ReloadLegalDocuments: () => stay(details),
    HoldTimerElapsed: () => stay(details),
    CheckoutCreated: () => stay(details),
    LegalDocumentsLoaded: () => stay(details),
    CodeApplied: () => stay(details),
    PriceAccepted: () => stay(details),
    Submitted: () => stay(details),
    PaymentEnded: () => stay(details),
    CommandFailed: () => stay(details),
  });

const create = (
  flow: CheckoutFlow,
  details: CheckoutDetails,
  checkoutAttemptId: string
): CheckoutStep => {
  const [operationId, next] = takeOperation(flow);
  const command = Command.CreateCheckout({
    operationId,
    request: {
      locale: flow.locale,
      checkoutSessionId: flow.checkoutSessionId,
      checkoutAttemptId,
      advertisedPriceToken: flow.advertisedPriceToken,
      selection: flow.selection,
      ...(flow.earlySetup === undefined ? {} : { earlySetup: flow.earlySetup }),
      ...details,
    },
    referralCode: flow.rememberedReferralCode,
  });
  return to(CheckoutState.Creating({ flow: next, details, command }), command);
};

/** Sends the same create again under a new operation id. */
const resendCreate = (creating: CreatingState): CheckoutStep => {
  const [resumed, command] = resendCreating(creating);
  return to(resumed, command);
};

const resendCreating = (
  creating: CreatingState
): readonly [CreatingState, CreateCheckoutCommand] => {
  const [operationId, flow] = takeOperation(creating.flow);
  const command = withOperation(creating.command, operationId);
  return [CheckoutState.Creating({ ...creating, flow, command }), command];
};

// Creating

const onCreating = (creating: CreatingState, event: CheckoutEvent) =>
  Event.$match(event, {
    CheckoutCreated: ({ operationId, start }) =>
      answers(creating.command, operationId)
        ? created(creating.flow, start)
        : stay(creating),
    CommandFailed: ({ operationId, problem }) =>
      answers(creating.command, operationId)
        ? createFailed(creating, problem)
        : stay(creating),
    Continue: () => stay(creating),
    CodeChanged: () => stay(creating),
    ApplyCode: () => stay(creating),
    AcceptPrice: () => stay(creating),
    ToggleConsent: () => stay(creating),
    Pay: () => stay(creating),
    Retry: () => stay(creating),
    ReloadLegalDocuments: () => stay(creating),
    HoldTimerElapsed: () => stay(creating),
    LegalDocumentsLoaded: () => stay(creating),
    CodeApplied: () => stay(creating),
    PriceAccepted: () => stay(creating),
    Submitted: () => stay(creating),
    PaymentEnded: () => stay(creating),
  });

const created = (flow: CheckoutFlow, start: CustomerCheckoutStart) =>
  Match.value(start).pipe(
    Match.discriminatorsExhaustive("status")({
      payment_disabled: () =>
        to(CheckoutState.Blocked({ reason: "payment-disabled" })),
      ready: (checkout) => enterReview(flow, checkout),
      price_review: (checkout) => enterReview(flow, checkout),
    })
  );

const enterReview = (
  flow: CheckoutFlow,
  checkout: CustomerCheckout
): CheckoutStep => {
  const [operationId, next] = takeOperation(flow);
  const update = rememberedReferralUpdate(checkout);
  return to(
    CheckoutState.Review({
      flow: withReferralUpdate(next, update),
      checkout: heldCheckout(checkout),
      code: { input: "", status: CodeStatus.Idle() },
      legal: LegalDocuments.Loading({ operationId }),
      consent: Option.none(),
      pending: Option.none(),
      notice: Option.none(),
    }),
    Command.LoadLegalDocuments({ operationId, locale: flow.locale }),
    ...referralCommands(update)
  );
};

const createFailed = (creating: CreatingState, problem: BookingProblem) =>
  BookingProblem.$match(problem, {
    Restart: ({ reason }) => to(CheckoutState.Restart({ reason })),
    Blocked: ({ reason }) => to(CheckoutState.Blocked({ reason })),
    DetailsInvalid: ({ field }) =>
      backToDetails(creating, DetailsNotice.DetailsInvalid({ field })),
    Retryable: ({ kind }) =>
      mayHaveApplied(kind)
        ? to(
            CheckoutState.Uncertain({
              resume: creating,
              retrying: false,
              notice: Option.some(kind),
            })
          )
        : createRetryable(creating, kind),
    Unconfirmed: () =>
      to(
        CheckoutState.Uncertain({
          resume: creating,
          retrying: false,
          notice: Option.none(),
        })
      ),
    // The contract doesn't answer a create with these.
    ShowStatus: () => createRetryable(creating, "unexpected"),
    PriceReviewPending: () => createRetryable(creating, "unexpected"),
    ConsentRequired: () => createRetryable(creating, "unexpected"),
    LegalDocumentsChanged: () => createRetryable(creating, "unexpected"),
    CodeRejected: () => createRetryable(creating, "unexpected"),
  });

const createRetryable = (creating: CreatingState, kind: CheckoutRetryKind) =>
  backToDetails(
    creating,
    DetailsNotice.Retryable({ kind, command: creating.command })
  );

const backToDetails = (creating: CreatingState, notice: DetailsNotice) =>
  to(
    CheckoutState.Details({
      flow: creating.flow,
      details: Option.some(creating.details),
      notice: Option.some(notice),
    })
  );

// Review

const onReview = (review: ReviewState, event: CheckoutEvent) =>
  Event.$match(event, {
    // The field and checkbox hold still while a write runs, so its answer
    // and any retry match what the customer sees.
    CodeChanged: ({ input }) =>
      Option.isSome(review.pending)
        ? stay(review)
        : stay(
            CheckoutState.Review({
              ...review,
              code: {
                input,
                status: CodeStatus.Idle(),
              },
              // A retry resends what was sent, so it lasts only until a change.
              notice: Option.none(),
            })
          ),
    ApplyCode: () =>
      whenIdle(review, () =>
        Option.liftPredicate(review.code.input.trim(), (code) => code !== "")
      ).pipe(
        Option.match({
          onNone: () => stay(review),
          onSome: (code) => applyCode(review, code),
        })
      ),
    AcceptPrice: () =>
      whenIdle(review, () => review.checkout.priceReview).pipe(
        Option.match({
          onNone: () => stay(review),
          onSome: () => acceptPrice(review),
        })
      ),
    ToggleConsent: ({ accepted }) =>
      Option.isSome(review.pending)
        ? stay(review)
        : toggleConsent(review, accepted),
    Pay: () =>
      canPay(review)
        ? review.consent.pipe(
            Option.match({
              onNone: () => stay(review),
              onSome: (documents) => submit(review, documents),
            })
          )
        : stay(review),
    Retry: () =>
      whenIdle(review, () =>
        review.notice.pipe(Option.filter(ReviewNotice.$is("Retryable")))
      ).pipe(
        Option.match({
          onNone: () => stay(review),
          onSome: ({ command }) => resendMutation(review, command),
        })
      ),
    ReloadLegalDocuments: () =>
      LegalDocuments.$is("Failed")(review.legal)
        ? reloadLegalDocuments(review)
        : stay(review),
    // A running submit may have executed; its answer decides.
    HoldTimerElapsed: ({ now }) =>
      submitting(review)
        ? stay(review)
        : expireHold(review, review.checkout, now),
    LegalDocumentsLoaded: ({ operationId, documents }) =>
      legalLoadAnswered(review, operationId)
        ? stay(
            CheckoutState.Review({
              ...review,
              legal: LegalDocuments.Loaded({ documents }),
              consent: Option.none(),
            })
          )
        : stay(review),
    CodeApplied: ({ operationId, result }) =>
      pendingAnswer(review, "ApplyDiscountCode", operationId).pipe(
        Option.match({
          onNone: () => stay(review),
          onSome: () => codeApplied(review, result),
        })
      ),
    PriceAccepted: ({ operationId, checkout }) =>
      pendingAnswer(review, "AcceptPriceChange", operationId).pipe(
        Option.match({
          onNone: () => stay(review),
          onSome: () => replaceCheckout(review, checkout),
        })
      ),
    Submitted: ({ operationId, submission }) =>
      pendingAnswer(review, "SubmitCheckout", operationId).pipe(
        Option.match({
          onNone: () => stay(review),
          onSome: () => submitted(review, submission),
        })
      ),
    CommandFailed: ({ operationId, problem }) =>
      review.pending.pipe(
        Option.filter((pending) => pending.operationId === operationId),
        Option.match({
          onSome: (pending) => reviewFailed(review, pending, problem),
          onNone: () =>
            legalLoadAnswered(review, operationId)
              ? stay(
                  CheckoutState.Review({
                    ...review,
                    legal: LegalDocuments.Failed(),
                  })
                )
              : stay(review),
        })
      ),
    Continue: () => stay(review),
    CheckoutCreated: () => stay(review),
    PaymentEnded: () => stay(review),
  });

/** `value` while no write runs. */
const whenIdle = <A>(
  review: ReviewState,
  value: () => Option.Option<A>
): Option.Option<A> =>
  Option.isNone(review.pending) ? value() : Option.none();

const applyCode = (review: ReviewState, code: string) => {
  const [operationId, flow] = takeOperation(review.flow);
  return sendMutation(
    CheckoutState.Review({ ...review, flow }),
    Command.ApplyDiscountCode({
      operationId,
      request: {
        locale: flow.locale,
        payStateToken: review.checkout.payStateToken,
        code,
      },
      referralCode: flow.rememberedReferralCode,
    })
  );
};

const acceptPrice = (review: ReviewState) => {
  const [operationId, flow] = takeOperation(review.flow);
  return sendMutation(
    CheckoutState.Review({ ...review, flow }),
    Command.AcceptPriceChange({
      operationId,
      request: {
        locale: flow.locale,
        payStateToken: review.checkout.payStateToken,
      },
    })
  );
};

const submit = (
  review: ReviewState,
  acceptedLegalDocuments: ReadonlyArray<{ key: string; hash: string }>
) => {
  const [operationId, flow] = takeOperation(review.flow);
  return sendMutation(
    CheckoutState.Review({ ...review, flow }),
    Command.SubmitCheckout({
      operationId,
      request: {
        locale: flow.locale,
        payStateToken: review.checkout.payStateToken,
        legalConsent: true,
        acceptedLegalDocuments,
        // The one checkbox also asks to start before the withdrawal period ends.
        ...(review.checkout.earlyPerformanceConsent.required
          ? { earlyPerformanceConsent: true }
          : {}),
      },
      referralCode: flow.rememberedReferralCode,
    })
  );
};

/** Sends `command` as the checkout's one running write. */
const sendMutation = (
  review: ReviewState,
  command: ReviewMutation
): CheckoutStep =>
  to(
    CheckoutState.Review({
      ...review,
      pending: Option.some(command),
      notice: Option.none(),
      code: Command.$is("ApplyDiscountCode")(command)
        ? { ...review.code, status: CodeStatus.Applying() }
        : review.code,
    }),
    command
  );

/** Sends a write that failed without changing anything again, unchanged. */
const resendMutation = (review: ReviewState, mutation: ReviewMutation) => {
  const [operationId, flow] = takeOperation(review.flow);
  return sendMutation(
    CheckoutState.Review({ ...review, flow }),
    withOperation(mutation, operationId)
  );
};

const toggleConsent = (review: ReviewState, accepted: boolean) =>
  LegalDocuments.$match(review.legal, {
    Loaded: ({ documents }) =>
      stay(
        CheckoutState.Review({
          ...review,
          consent: accepted
            ? Option.some(acceptedDocuments(documents))
            : Option.none(),
          // A retry resends what was sent, so it lasts only until a change.
          notice: Option.none(),
        })
      ),
    Loading: () => stay(review),
    Failed: () => stay(review),
  });

const acceptedDocuments = (documents: ReadonlyArray<CustomerLegalDocument>) =>
  documents.map(({ key, hash }) => ({ key, hash }));

const reloadLegalDocuments = (review: ReviewState): CheckoutStep => {
  const [operationId, flow] = takeOperation(review.flow);
  return to(
    CheckoutState.Review({
      ...review,
      flow,
      legal: LegalDocuments.Loading({ operationId }),
      consent: Option.none(),
    }),
    Command.LoadLegalDocuments({ operationId, locale: flow.locale })
  );
};

const legalLoadAnswered = (
  review: ReviewState,
  operationId: CheckoutOperationId
) =>
  LegalDocuments.$match(review.legal, {
    Loading: (loading) => loading.operationId === operationId,
    Loaded: () => false,
    Failed: () => false,
  });

const pendingAnswer = <Tag extends ReviewMutation["_tag"]>(
  review: ReviewState,
  tag: Tag,
  operationId: CheckoutOperationId
) =>
  review.pending.pipe(
    Option.filter((pending) => pending.operationId === operationId),
    Option.filter(Command.$is(tag))
  );

/**
 * A code answered with a price review and no `discountCode` isn't applied:
 * the customer accepts the price, then applies the code again.
 */
const codeApplied = (
  review: ReviewState,
  result: CustomerCheckoutDiscountCodeResult
) =>
  replaceCheckout(
    CheckoutState.Review({
      ...review,
      code: {
        input: review.code.input,
        status: Option.fromUndefinedOr(result.discountCode).pipe(
          Option.match({
            onNone: () => CodeStatus.AwaitingPriceAcceptance(),
            onSome: (outcome) => CodeStatus.Applied({ outcome }),
          })
        ),
      },
    }),
    result
  );

/**
 * Takes a checkout answer as the whole truth about the held order: token,
 * summary, expiry, price review and early-performance requirement.
 */
const replaceCheckout = (
  review: ReviewState,
  checkout: CustomerCheckout
): CheckoutStep => {
  const update = rememberedReferralUpdate(checkout);
  return to(
    CheckoutState.Review({
      ...review,
      flow: withReferralUpdate(review.flow, update),
      checkout: heldCheckout(checkout),
      // The checkbox asks to start early only while that's required, so a
      // tick given before doesn't cover it.
      consent:
        checkout.earlyPerformanceConsent.required &&
        !review.checkout.earlyPerformanceConsent.required
          ? Option.none()
          : review.consent,
      pending: Option.none(),
      notice: Option.none(),
    }),
    ...referralCommands(update)
  );
};

const submitted = (
  review: ReviewState,
  submission: CustomerCheckoutSubmission
): CheckoutStep =>
  Match.value(submission).pipe(
    Match.discriminatorsExhaustive("status")({
      payment_required: ({ orderId, paymentUrl, statusUrl }) => {
        const [operationId, flow] = takeOperation(review.flow);
        const opening = Command.OpenPayment({
          operationId,
          orderId,
          paymentUrl,
          returnUrl: paymentReturnUrl(orderId, statusUrl),
        });
        return to(
          CheckoutState.Paying({
            flow,
            orderId,
            paymentUrl,
            returnUrl: opening.returnUrl,
            opening: Option.some(opening),
            notice: Option.none(),
          }),
          opening,
          trackSubmitted(flow)
        );
      },
      paid: (paid) => {
        const update = rememberedReferralUpdate(paid);
        return to(
          CheckoutState.Done({ orderId: paid.orderId }),
          ...referralCommands(update),
          trackSubmitted(review.flow)
        );
      },
      ready: (checkout) => replaceCheckout(review, checkout),
      price_review: (checkout) => replaceCheckout(review, checkout),
    })
  );

const trackSubmitted = (flow: CheckoutFlow) =>
  Command.TrackBookingSubmitted({ family: flow.selection.family });

const reviewFailed = (
  review: ReviewState,
  failedMutation: ReviewMutation,
  problem: BookingProblem
): CheckoutStep => {
  const settled = CheckoutState.Review({
    ...review,
    pending: Option.none(),
    code: Command.$is("ApplyDiscountCode")(failedMutation)
      ? { ...review.code, status: CodeStatus.Idle() }
      : review.code,
  });
  return BookingProblem.$match(problem, {
    Restart: ({ reason }) => to(CheckoutState.Restart({ reason })),
    ShowStatus: () => showStatus(review),
    Blocked: ({ reason }) => to(CheckoutState.Blocked({ reason })),
    PriceReviewPending: () =>
      stay(
        CheckoutState.Review({
          ...settled,
          checkout: {
            ...settled.checkout,
            priceReview: Option.orElseSome(
              settled.checkout.priceReview,
              () => ({ sectionKeys: [], itemKeys: [] })
            ),
          },
          code: Command.$is("ApplyDiscountCode")(failedMutation)
            ? { ...settled.code, status: CodeStatus.AwaitingPriceAcceptance() }
            : settled.code,
        })
      ),
    ConsentRequired: ({ consent }) =>
      stay(
        CheckoutState.Review({
          ...settled,
          checkout: Match.value(consent).pipe(
            Match.when("early_performance", () => ({
              ...settled.checkout,
              earlyPerformanceConsent: {
                ...settled.checkout.earlyPerformanceConsent,
                required: true,
              },
            })),
            Match.when("legal", () => settled.checkout),
            Match.exhaustive
          ),
          consent: Option.none(),
          notice: Option.some(ReviewNotice.ConsentRequired({ consent })),
        })
      ),
    LegalDocumentsChanged: () =>
      reloadLegalDocuments(
        CheckoutState.Review({
          ...settled,
          notice: Option.some(ReviewNotice.LegalDocumentsChanged()),
        })
      ),
    CodeRejected: ({ reason, replacement }) =>
      stay(
        CheckoutState.Review({
          ...settled,
          checkout: Option.match(replacement, {
            onNone: () => settled.checkout,
            onSome: (token) => withReplacementToken(settled.checkout, token),
          }),
          code: { ...settled.code, status: CodeStatus.Rejected({ reason }) },
        })
      ),
    Retryable: ({ kind }) =>
      Command.$is("SubmitCheckout")(failedMutation) && mayHaveApplied(kind)
        ? to(
            CheckoutState.Uncertain({
              resume: review,
              retrying: false,
              notice: Option.some(kind),
            })
          )
        : reviewRetryable(settled, failedMutation, kind),
    Unconfirmed: () =>
      to(
        CheckoutState.Uncertain({
          resume: review,
          retrying: false,
          notice: Option.none(),
        })
      ),
    DetailsInvalid: () =>
      reviewRetryable(settled, failedMutation, "unexpected"),
  });
};

/**
 * The server answers "unavailable" for a failure after its own work too:
 * a create may have held the selection, and a submit may have started the
 * payment, before a later step failed. A code or price acceptance only
 * signs a new token, so it is safe to treat as not applied.
 */
const mayHaveApplied = (kind: CheckoutRetryKind) =>
  kind === "service_unavailable";

const reviewRetryable = (
  review: ReviewState,
  command: ReviewMutation,
  kind: CheckoutRetryKind
) =>
  stay(
    CheckoutState.Review({
      ...review,
      notice: Option.some(ReviewNotice.Retryable({ kind, command })),
    })
  );

const withReplacementToken = (
  checkout: HeldCheckout,
  { payStateToken, expiresAt }: CheckoutReplacementToken
): HeldCheckout => ({ ...checkout, payStateToken, expiresAt });

// Uncertain

/**
 * Only `Retry` leaves an unsettled write: it resends the write unchanged
 * and the answer settles it. A resend that fails without changing anything
 * leaves the write unsettled, since the first send may still have applied.
 */
const onUncertain = (
  uncertain: UncertainState,
  event: CheckoutEvent
): CheckoutStep =>
  Event.$match(event, {
    Retry: () => (uncertain.retrying ? stay(uncertain) : resend(uncertain)),
    HoldTimerElapsed: ({ now }) =>
      Match.valueTags(uncertain.resume, {
        Creating: () => stay(uncertain),
        Review: (review) =>
          holdExpiredAt(review.checkout, now)
            ? expiredUnsettled(review)
            : stay(uncertain),
      }),
    CommandFailed: ({ operationId, problem }) =>
      answersResend(uncertain, operationId)
        ? resendFailed(uncertain, problem)
        : besideWrite(uncertain, operationId, event),
    CheckoutCreated: ({ operationId }) =>
      answersResend(uncertain, operationId)
        ? settleWith(uncertain.resume, event)
        : stay(uncertain),
    CodeApplied: ({ operationId }) =>
      answersResend(uncertain, operationId)
        ? settleWith(uncertain.resume, event)
        : stay(uncertain),
    PriceAccepted: ({ operationId }) =>
      answersResend(uncertain, operationId)
        ? settleWith(uncertain.resume, event)
        : stay(uncertain),
    Submitted: ({ operationId }) =>
      answersResend(uncertain, operationId)
        ? settleWith(uncertain.resume, event)
        : stay(uncertain),
    LegalDocumentsLoaded: ({ operationId }) =>
      besideWrite(uncertain, operationId, event),
    Continue: () => stay(uncertain),
    CodeChanged: () => stay(uncertain),
    ApplyCode: () => stay(uncertain),
    AcceptPrice: () => stay(uncertain),
    ToggleConsent: () => stay(uncertain),
    Pay: () => stay(uncertain),
    ReloadLegalDocuments: () => stay(uncertain),
    PaymentEnded: () => stay(uncertain),
  });

/** A submit that may have executed never restarts the booking. */
const expiredUnsettled = (review: ReviewState) =>
  submitting(review) ? showStatus(review) : restartExpired();

const resend = (uncertain: UncertainState): CheckoutStep => {
  const [resume, command] = Match.valueTags(uncertain.resume, {
    Creating: (creating) => {
      const [resumed, command] = resendCreating(creating);
      return [resumed, [command]] as const;
    },
    Review: (review) => resendReviewMutation(review),
  });
  return to(
    CheckoutState.Uncertain({ resume, retrying: true, notice: Option.none() }),
    ...command
  );
};

const resendReviewMutation = (
  review: ReviewState
): readonly [ReviewState, ReadonlyArray<CheckoutCommand>] => {
  const [operationId, flow] = takeOperation(review.flow);
  const pending = Option.map(review.pending, (mutation) =>
    withOperation(mutation, operationId)
  );
  return [
    CheckoutState.Review({ ...review, flow, pending }),
    Option.toArray(pending),
  ];
};

/** The in-flight write's operation id, while a resend runs. */
const answersResend = (
  uncertain: UncertainState,
  operationId: CheckoutOperationId
) =>
  uncertain.retrying &&
  Match.valueTags(uncertain.resume, {
    Creating: ({ command }) => answers(command, operationId),
    Review: ({ pending }) =>
      Option.exists(pending, (mutation) => answers(mutation, operationId)),
  });

const resendFailed = (
  uncertain: UncertainState,
  problem: BookingProblem
): CheckoutStep =>
  BookingProblem.$match(problem, {
    Retryable: ({ kind }) =>
      to(
        CheckoutState.Uncertain({
          ...uncertain,
          retrying: false,
          notice: Option.some(kind),
        })
      ),
    Unconfirmed: () =>
      to(
        CheckoutState.Uncertain({
          ...uncertain,
          retrying: false,
          notice: Option.none(),
        })
      ),
    Restart: () => settleResendFailure(uncertain.resume, problem),
    ShowStatus: () => settleResendFailure(uncertain.resume, problem),
    Blocked: () => settleResendFailure(uncertain.resume, problem),
    DetailsInvalid: () => settleResendFailure(uncertain.resume, problem),
    PriceReviewPending: () => settleResendFailure(uncertain.resume, problem),
    ConsentRequired: () => settleResendFailure(uncertain.resume, problem),
    LegalDocumentsChanged: () => settleResendFailure(uncertain.resume, problem),
    CodeRejected: () => settleResendFailure(uncertain.resume, problem),
  });

/**
 * A refused resend of a submit doesn't say the first send didn't execute:
 * the server checks the token, documents and consents before it recovers a
 * payment already started. The status screen decides.
 */
const settleResendFailure = (
  resume: UncertainResume,
  problem: BookingProblem
): CheckoutStep =>
  Match.valueTags(resume, {
    Creating: (creating) => createFailed(creating, problem),
    Review: (review) =>
      submitting(review) ? showStatus(review) : settleFailure(review, problem),
  });

const settleFailure = (
  review: ReviewState,
  problem: BookingProblem
): CheckoutStep =>
  Option.match(review.pending, {
    onNone: () => stay(review),
    onSome: (pending) => reviewFailed(review, pending, problem),
  });

/** Answers the resent write from the state it was sent from. */
const settleWith = (
  resume: UncertainResume,
  event: CheckoutEvent
): CheckoutStep =>
  Match.valueTags(resume, {
    Creating: (creating) => onCreating(creating, event),
    Review: (review) => onReview(review, event),
  });

/**
 * An answer to the running document load, which leaves the write unsettled.
 * Any other answer belongs to a send already settled as unknown and is
 * dropped.
 */
const besideWrite = (
  uncertain: UncertainState,
  operationId: CheckoutOperationId,
  event: CheckoutEvent
): CheckoutStep =>
  Match.valueTags(uncertain.resume, {
    Creating: () => stay(uncertain),
    Review: (review) => {
      if (!legalLoadAnswered(review, operationId)) return stay(uncertain);
      const next = onReview(review, event);
      return CheckoutState.$is("Review")(next.state)
        ? to(
            CheckoutState.Uncertain({ ...uncertain, resume: next.state }),
            ...next.commands
          )
        : stay(uncertain);
    },
  });

// Paying

const onPaying = (paying: PayingState, event: CheckoutEvent) =>
  Event.$match(event, {
    PaymentEnded: ({ operationId }) =>
      Option.exists(paying.opening, (opening) => answers(opening, operationId))
        ? to(CheckoutState.Done({ orderId: paying.orderId }))
        : stay(paying),
    CommandFailed: ({ operationId, problem }) =>
      Option.exists(paying.opening, (opening) => answers(opening, operationId))
        ? stay(
            CheckoutState.Paying({
              ...paying,
              opening: Option.none(),
              notice: Option.some(retryKind(problem)),
            })
          )
        : stay(paying),
    Retry: () =>
      Option.isNone(paying.opening) ? reopen(paying) : stay(paying),
    Continue: () => stay(paying),
    CodeChanged: () => stay(paying),
    ApplyCode: () => stay(paying),
    AcceptPrice: () => stay(paying),
    ToggleConsent: () => stay(paying),
    Pay: () => stay(paying),
    ReloadLegalDocuments: () => stay(paying),
    // The submit went through; the hold is the gateway's now.
    HoldTimerElapsed: () => stay(paying),
    CheckoutCreated: () => stay(paying),
    LegalDocumentsLoaded: () => stay(paying),
    CodeApplied: () => stay(paying),
    PriceAccepted: () => stay(paying),
    Submitted: () => stay(paying),
  });

const reopen = (paying: PayingState): CheckoutStep => {
  const [operationId, flow] = takeOperation(paying.flow);
  const opening = Command.OpenPayment({
    operationId,
    orderId: paying.orderId,
    paymentUrl: paying.paymentUrl,
    returnUrl: paying.returnUrl,
  });
  return to(
    CheckoutState.Paying({
      ...paying,
      flow,
      opening: Option.some(opening),
      notice: Option.none(),
    }),
    opening
  );
};

const retryKind = (problem: BookingProblem): CheckoutRetryKind =>
  BookingProblem.$match(problem, {
    Retryable: ({ kind }) => kind,
    Restart: unexpected,
    ShowStatus: unexpected,
    Blocked: unexpected,
    DetailsInvalid: unexpected,
    PriceReviewPending: unexpected,
    ConsentRequired: unexpected,
    LegalDocumentsChanged: unexpected,
    CodeRejected: unexpected,
    Unconfirmed: unexpected,
  });

/** Opening the payment page fails only as retryable; anything else is a surprise. */
const unexpected = (): CheckoutRetryKind => "unexpected";

// Shared

const stay = (state: CheckoutState): CheckoutStep => ({ state, commands: [] });

const to = (
  state: CheckoutState,
  ...commands: ReadonlyArray<CheckoutCommand>
): CheckoutStep => ({ state, commands });

const takeOperation = (
  flow: CheckoutFlow
): readonly [CheckoutOperationId, CheckoutFlow] => [
  flow.nextOperationId,
  { ...flow, nextOperationId: flow.nextOperationId + 1 },
];

const withOperation = <Sent extends { readonly operationId: number }>(
  command: Sent,
  operationId: CheckoutOperationId
): Sent => ({ ...command, operationId });

const answers = (
  command: { readonly operationId: CheckoutOperationId },
  operationId: CheckoutOperationId
) => command.operationId === operationId;

/** Restarts once the hold's token stops working, else stays in `state`. */
const expireHold = (
  state: CheckoutState,
  checkout: HeldCheckout,
  now: number
): CheckoutStep =>
  holdExpiredAt(checkout, now) ? restartExpired() : stay(state);

const holdExpiredAt = (checkout: HeldCheckout, now: number) =>
  Date.parse(checkout.expiresAt) <= now;

const restartExpired = () =>
  to(CheckoutState.Restart({ reason: "hold_expired" }));

/** Whether the running or unsettled write is a submit, which may have executed. */
const submitting = (review: ReviewState) =>
  Option.exists(review.pending, Command.$is("SubmitCheckout"));

const showStatus = (review: ReviewState) =>
  to(CheckoutState.Done({ orderId: review.checkout.orderId }));

const heldCheckout = (checkout: CustomerCheckout): HeldCheckout => ({
  orderId: checkout.orderId,
  payStateToken: checkout.payStateToken,
  expiresAt: checkout.expiresAt,
  summary: checkout.summary,
  priceReview: Option.fromUndefinedOr(checkout.priceReview).pipe(
    Option.map(({ changedKeys }) => changedKeys)
  ),
  earlyPerformanceConsent: checkout.earlyPerformanceConsent,
  referralApplied: checkout.referralApplied === true,
});

const withReferralUpdate = (
  flow: CheckoutFlow,
  update: Option.Option<RememberedReferralUpdate>
): CheckoutFlow =>
  Option.match(update, {
    onNone: () => flow,
    onSome: (applied) => ({
      ...flow,
      rememberedReferralCode: applyRememberedReferralUpdate(applied),
    }),
  });

const referralCommands = (
  update: Option.Option<RememberedReferralUpdate>
): ReadonlyArray<CheckoutCommand> =>
  Option.toArray(
    Option.map(update, (applied) =>
      Command.UpdateRememberedReferral({ update: applied })
    )
  );
