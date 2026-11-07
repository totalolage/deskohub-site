import {
  type ApplyCustomerCheckoutDiscountCode,
  type CreateCustomerCheckout,
  CustomerAccountLinkRequired,
  type CustomerAccountState,
  type CustomerAvailability,
  type CustomerBookableCoworkTier,
  type CustomerBookingApi,
  CustomerBookingDateOutOfRange,
  type CustomerBookingSelection,
  CustomerBookingSelectionInvalid,
  type CustomerBookingSelectionQuery,
  type CustomerCheckout,
  type CustomerCheckoutChangedKeys,
  type CustomerCheckoutDiscountCodeResult,
  CustomerCheckoutNotFound,
  type CustomerCheckoutStart,
  type CustomerCheckoutSubmission,
  CustomerCheckoutUnavailable,
  type CustomerCheckoutUnavailableReason,
  CustomerConsentRequired,
  CustomerDiscountCodeRejected,
  CustomerLegalDocumentsChanged,
  type CustomerLocale,
  type CustomerMeetingRoomDuration,
  type CustomerMonitorOption,
  CustomerOfferingUnavailable,
  CustomerQuoteExpired,
  CustomerReservationOrderId,
  type CustomerReservationSummary,
  CustomerSelectionUnavailable,
  customerReferralCodeHeader,
  type Money,
  ReferralCode,
  type SubmitCustomerCheckout,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect, Match, Option } from "effect";
import {
  HttpApiBuilder,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  type FakeRequestOutcome,
  type FakeWorkspace,
  fakeWorkspaceOrigin,
} from "../../customer-api/testing/fake-workspace";
import {
  type SampleOrder,
  sampleInvoicePdf,
} from "../../customer-api/testing/sample-fixtures";
import { selectionKey } from "../selection/booking-selection";
import {
  addDays,
  type PragueDate,
  pragueDateTimeAt,
  pragueMidnight,
  pragueToday,
} from "../selection/prague-date";
import { issueFakePaymentPage } from "./fake-payment-gateway";
import {
  inclusiveDays,
  pricedLines,
  sampleLegalDocuments,
  sampleOfferings,
  sampleSummary,
} from "./sample-booking-catalog";

/**
 * The booking group of the fake Workspace: all nine booking endpoints over
 * synthetic data, served through the real contract, with per-test scripting.
 * State lives here, keyed by the `FakeWorkspace` instance, so the fake
 * Workspace's public shape stays #991's. Get it with `fakeBooking(workspace)`.
 */

type BookingEndpoint = HttpApiGroup.Endpoints<typeof CustomerBookingApi>;
export type BookingEndpointName = HttpApiEndpoint.Name<BookingEndpoint>;
type Endpoint<N extends BookingEndpointName> = HttpApiEndpoint.WithName<
  BookingEndpoint,
  N
>;
type Success<N extends BookingEndpointName> = HttpApiEndpoint.Success<
  Endpoint<N>
>["Type"];
type Failure<N extends BookingEndpointName> = HttpApiEndpoint.Error<
  Endpoint<N>
>["Type"];
type Input<N extends BookingEndpointName> =
  HttpApiEndpoint.Request<Endpoint<N>> extends { readonly payload: infer P }
    ? P
    : HttpApiEndpoint.Request<Endpoint<N>> extends { readonly query: infer Q }
      ? Q
      : never;

/** One request the booking group answered, in arrival order. */
export type FakeBookingCall = {
  readonly [N in BookingEndpointName]: {
    readonly endpoint: N;
    /** The decoded query or payload. */
    readonly input: Input<N>;
    /** The `x-deskohub-referral-code` header, when the request sent one. */
    readonly referralCode: string | undefined;
  };
}[BookingEndpointName];

/** Endpoints whose answer can be a checkout in `price_review`. */
export type PriceReviewEndpoint =
  | "createCheckout"
  | "applyCheckoutDiscountCode"
  | "submitCheckout";

/** An answer the next request to an endpoint gets instead of the fake's own. */
type ScriptedAnswer<N extends BookingEndpointName> =
  | { readonly _tag: "Fail"; readonly error: Failure<N> }
  | { readonly _tag: "Succeed"; readonly value: Success<N> }
  | OwnFlowScript;

type ChangedKeys = typeof CustomerCheckoutChangedKeys.Type;

/** The codes the fake knows; any other code is rejected as `unavailable`. */
export const fakeBookingCodes = {
  /** Takes 10% off. */
  discount: "SAMPLE10",
  /** Takes everything off, so submitting answers `paid`. */
  free: "SAMPLE100",
  /** A referral code: `referral_accepted`, and remember it. */
  referral: ReferralCode.make("SAMPLEFRIEND"),
  /** Rejected as `unavailable` with a replacement pay state. */
  expiredWithReplacement: "SAMPLEOLD",
} as const;

/** A held order as the fake keeps it. */
export interface FakeBookingCheckout {
  readonly orderId: string;
  readonly selection: CustomerBookingSelection;
  readonly locale: CustomerLocale;
  readonly expiresAt: Date;
  readonly status: "ready" | "price_review" | "submitted";
  readonly changedKeys: ChangedKeys | undefined;
  /** Crowns added by the price changes so far. */
  readonly surcharge: number;
  readonly code: string | undefined;
  readonly referralApplied: boolean;
  readonly earlyPerformanceRequired: boolean;
}

export const fakeHoldDuration = 10 * 60_000;
const withdrawalPeriodDays = 14;

/** The booking state and scripts of one fake Workspace. */
export class FakeBookingApi {
  /** Requests in arrival order, with what they sent. */
  readonly calls: FakeBookingCall[] = [];
  /** The clock checkouts expire by; tests may replace it. */
  now: () => Date = () => new Date();
  /** Dates nothing can be booked on. */
  unavailableDates: string[];
  /** Dates a Reserved Desk needs a monitor workstation on. */
  workstationRequiredDates: string[];
  /** Cowork tiers sold out on a date. */
  readonly unavailableTiers = new Map<
    string,
    ReadonlyArray<CustomerBookableCoworkTier>
  >();
  unavailableMonitorOptions: CustomerMonitorOption[] = ["2x32-4k"];
  /** While true, office quotes and checkouts answer `CustomerOfferingUnavailable`. */
  officeClosed = false;
  /** Bumped by `changeLegalDocuments`; earlier hashes stop being accepted. */
  legalVersion = 1;

  private readonly answers = new Map<
    BookingEndpointName,
    Array<ScriptedAnswer<BookingEndpointName>>
  >();
  /** Each order's latest state, for assertions. */
  private readonly checkouts = new Map<string, FakeBookingCheckout>();
  /** Each pay state token's own snapshot, as a signed token carries it. */
  private readonly tokens = new Map<string, FakeBookingCheckout>();
  /** The order each checkout attempt created, so a retry gets it back. */
  private readonly attempts = new Map<string, string>();
  private readonly quotes = new Map<string, string>();
  private sequence = 0;

  constructor(private readonly workspace: FakeWorkspace) {
    const today = this.today();
    this.unavailableDates = [addDays(today, 3), addDays(today, 10)];
    this.workstationRequiredDates = [addDays(today, 5)];
    this.unavailableTiers.set(addDays(today, 7), ["reserved-desk"]);
  }

  /** Today in Prague by `now`. */
  today() {
    return pragueToday(this.now());
  }

  /** The Prague date `days` after today. */
  dateIn(days: number) {
    return addDays(this.today(), days);
  }

  /**
   * Answers the endpoint's next `times` requests with a transport-level
   * outcome (401, 429, 503, a broken connection after handling, or no
   * answer), through the fake Workspace's middleware.
   */
  fail(endpoint: BookingEndpointName, outcome: FakeRequestOutcome, times = 1) {
    // FakeWorkspace types `fail` over its own groups, but its middleware
    // takes outcomes for any endpoint name.
    this.workspace.fail(
      endpoint as Parameters<FakeWorkspace["fail"]>[0],
      outcome,
      times
    );
  }

  /** Answers the endpoint's next `times` requests with `error`. */
  reject<N extends BookingEndpointName>(
    endpoint: N,
    error: Failure<N>,
    times = 1
  ) {
    this.script(endpoint, { _tag: "Fail", error }, times);
  }

  /** Answers the endpoint's next `times` requests with `value`. */
  respond<N extends BookingEndpointName>(
    endpoint: N,
    value: Success<N>,
    times = 1
  ) {
    this.script(endpoint, { _tag: "Succeed", value }, times);
  }

  /**
   * Changes the price at the endpoint's next request: the checkout answers
   * `price_review` with `changedKeys` until the price is accepted.
   */
  forcePriceReview(
    endpoint: PriceReviewEndpoint,
    changedKeys?: ChangedKeys,
    times = 1
  ) {
    this.script(
      endpoint,
      {
        _tag: "PriceReview",
        changedKeys: changedKeys ?? defaultChangedKeys,
      },
      times
    );
  }

  /** The next checkout is a review account's: `payment_disabled`. */
  disablePayment(times = 1) {
    this.script("createCheckout", { _tag: "PaymentDisabled" }, times);
  }

  /** Publishes new legal document versions. */
  changeLegalDocuments() {
    this.legalVersion += 1;
  }

  /** The held order, for assertions. */
  checkout(orderId: string) {
    return this.checkouts.get(orderId);
  }

  /** The endpoint names requested, in order. */
  get endpoints(): ReadonlyArray<BookingEndpointName> {
    return this.calls.map((call) => call.endpoint);
  }

  /** @internal */
  record(call: FakeBookingCall) {
    this.calls.push(call);
  }

  /** @internal Takes the endpoint's next scripted answer. */
  nextAnswer<N extends BookingEndpointName>(
    endpoint: N
  ): ScriptedAnswer<N> | undefined {
    const queued = this.answers.get(endpoint);
    const next = queued?.shift();
    if (queued?.length === 0) this.answers.delete(endpoint);
    return next as ScriptedAnswer<N> | undefined;
  }

  /** @internal */
  nextId(prefix: string) {
    this.sequence += 1;
    return `${prefix}-${this.sequence.toString().padStart(4, "0")}`;
  }

  /** @internal Issues a quote token bound to the selection. */
  issueQuoteToken(selection: CustomerBookingSelection) {
    const key = selectionKey(selection);
    const token = `sq1.${fnv1a(key)}.${fnv1a(this.nextId("quote"))}`;
    this.quotes.set(token, key);
    return token;
  }

  /** @internal Whether the token was issued for this selection. */
  quoteMatches(token: string, selection: CustomerBookingSelection) {
    return this.quotes.get(token) === selectionKey(selection);
  }

  /**
   * @internal Stores the order's new state and returns a pay state token
   * for that snapshot. Earlier tokens keep their own snapshots until the
   * hold ends, as signed tokens do.
   */
  hold(checkout: FakeBookingCheckout) {
    this.checkouts.set(checkout.orderId, checkout);
    const token = `ps1.${fnv1a(checkout.orderId)}.${fnv1a(this.nextId("pay-state"))}`;
    this.tokens.set(token, checkout);
    return token;
  }

  /** @internal The snapshot a pay state token carries. */
  held(token: string) {
    return this.tokens.get(token);
  }

  /**
   * @internal Marks the order submitted, so no token of it is payable again,
   * and books it in the Workspace's reservations: fulfilled when nothing is
   * left to pay, else pending until its payment completes.
   */
  submit(checkout: FakeBookingCheckout) {
    const submitted = { ...checkout, status: "submitted" as const };
    this.checkouts.set(checkout.orderId, submitted);
    const { total } = summaryOf(submitted);
    this.book(submitted, total, total.value === 0 ? "fulfilled" : "pending");
  }

  /**
   * Completes a submitted order's payment, as its payment page does: the
   * order is paid and fulfilled, with its door code and invoice.
   */
  completePayment(orderId: string) {
    const checkout = this.checkouts.get(orderId);
    if (checkout?.status !== "submitted") return;
    this.book(checkout, summaryOf(checkout).total, "fulfilled");
  }

  /** @internal The order's payment page; completing it completes the payment. */
  paymentPage(orderId: string) {
    return issueFakePaymentPage(orderId, () => this.completePayment(orderId));
  }

  /** @internal Whether a payment for the order started. */
  submitted(orderId: string) {
    return this.checkouts.get(orderId)?.status === "submitted";
  }

  /** @internal The order an earlier identical create made. */
  attempted(sessionId: string, attemptId: string) {
    const orderId = this.attempts.get(`${sessionId}\u0000${attemptId}`);
    return orderId === undefined ? undefined : this.checkouts.get(orderId);
  }

  /** @internal Remembers the order a create attempt made. */
  attempt(sessionId: string, attemptId: string, orderId: string) {
    this.attempts.set(`${sessionId}\u0000${attemptId}`, orderId);
  }

  /** Puts the order and its history row in the Workspace's reservations. */
  private book(
    checkout: FakeBookingCheckout,
    total: Money,
    status: BookedStatus
  ) {
    const { order, row } = bookedReservation(checkout, total, status);
    const { data } = this.workspace;
    const { current } = data.history;
    this.workspace.data = {
      ...data,
      orders: new Map(data.orders).set(checkout.orderId, order),
      history: {
        ...data.history,
        current: current.some((entry) => entry.orderId === checkout.orderId)
          ? current.map((entry) =>
              entry.orderId === checkout.orderId ? row : entry
            )
          : [...current, row],
      },
    };
  }

  private script<N extends BookingEndpointName>(
    endpoint: N,
    answer: ScriptedAnswer<N>,
    times: number
  ) {
    const queued = this.answers.get(endpoint) ?? [];
    this.answers.set(endpoint, [
      ...queued,
      ...Array.from(
        { length: times },
        () => answer as ScriptedAnswer<BookingEndpointName>
      ),
    ]);
  }
}

const defaultChangedKeys: ChangedKeys = {
  sectionKeys: ["order", "total"],
  itemKeys: ["total:final"],
};

const states = new WeakMap<FakeWorkspace, FakeBookingApi>();

/** The booking state and scripts of `workspace`, created on first use. */
export const fakeBooking = (workspace: FakeWorkspace): FakeBookingApi => {
  const existing = states.get(workspace);
  if (existing !== undefined) return existing;
  const created = new FakeBookingApi(workspace);
  states.set(workspace, created);
  return created;
};

/** The booking group's handlers over `workspace`'s booking state. */
export const fakeBookingGroup = (workspace: FakeWorkspace) => {
  const booking = fakeBooking(workspace);

  const received = <N extends BookingEndpointName>(
    endpoint: N,
    input: Input<N>,
    headers: Readonly<Record<string, string | undefined>>
  ) =>
    Effect.sync(() =>
      booking.record({
        endpoint,
        input,
        referralCode: headers[customerReferralCodeHeader],
      } as FakeBookingCall)
    );

  /** Runs the scripted answer when one is queued, else the fake's own. */
  const answer = <N extends BookingEndpointName, R>(
    endpoint: N,
    own: (
      scripted: OwnFlowScript | undefined
    ) => Effect.Effect<Success<N>, Failure<N>, R>
  ) =>
    Effect.suspend(() => {
      const scripted = booking.nextAnswer(endpoint);
      if (scripted?._tag === "Fail") return Effect.fail(scripted.error);
      if (scripted?._tag === "Succeed") return Effect.succeed(scripted.value);
      return own(scripted);
    });

  return HttpApiBuilder.group(WorkspaceCustomerApi, "booking", (handlers) =>
    handlers
      .handle("listOfferings", ({ query, request }) =>
        received("listOfferings", query, request.headers).pipe(
          Effect.andThen(
            answer("listOfferings", () =>
              Effect.sync(() => sampleOfferings(query.locale, booking.today()))
            )
          )
        )
      )
      .handle("getAvailability", ({ query, request }) =>
        received("getAvailability", query, request.headers).pipe(
          Effect.andThen(
            answer("getAvailability", () => availability(booking, query))
          )
        )
      )
      .handle("getMeetingRoomStartTimes", ({ query, request }) =>
        received("getMeetingRoomStartTimes", query, request.headers).pipe(
          Effect.andThen(
            answer("getMeetingRoomStartTimes", () =>
              Effect.sync(() =>
                meetingRoomStartTimes(booking, query.date, query.duration)
              )
            )
          )
        )
      )
      .handle("getQuote", ({ query, request }) =>
        received("getQuote", query, request.headers).pipe(
          Effect.andThen(
            answer("getQuote", () => {
              const { locale: _locale, ...fields } = query;
              const selection = selectionOfQuery(fields);
              return checkedSelection(booking, selection).pipe(
                Effect.map(() => {
                  const summary = sampleSummary({
                    lines: pricedLines(selection),
                  });
                  return {
                    family: selection.family,
                    total: summary.total,
                    regularPrice: summary.total,
                    discount: { ...summary.total, value: 0 },
                    quotedAt: booking.now().toISOString(),
                    summary,
                    advertisedPriceToken: booking.issueQuoteToken(selection),
                  };
                })
              );
            })
          )
        )
      )
      .handle("listLegalDocuments", ({ query, request }) =>
        received("listLegalDocuments", query, request.headers).pipe(
          Effect.andThen(
            answer("listLegalDocuments", () =>
              Effect.sync(() => ({
                documents: sampleLegalDocuments(
                  query.locale,
                  booking.legalVersion
                ),
              }))
            )
          )
        )
      )
      .handle("createCheckout", ({ payload, request }) =>
        received("createCheckout", payload, request.headers).pipe(
          Effect.andThen(
            answer("createCheckout", (scripted) =>
              createCheckout({
                workspace,
                booking,
                payload,
                remembered: request.headers[customerReferralCodeHeader],
                scripted,
              })
            )
          )
        )
      )
      .handle("applyCheckoutDiscountCode", ({ payload, request }) =>
        received("applyCheckoutDiscountCode", payload, request.headers).pipe(
          Effect.andThen(
            answer("applyCheckoutDiscountCode", (scripted) =>
              applyDiscountCode({ booking, payload, scripted })
            )
          )
        )
      )
      .handle("acceptCheckoutPriceChange", ({ payload, request }) =>
        received("acceptCheckoutPriceChange", payload, request.headers).pipe(
          Effect.andThen(
            answer("acceptCheckoutPriceChange", () =>
              held(booking, payload.payStateToken).pipe(
                Effect.flatMap((current) =>
                  answerCheckout(booking, {
                    ...current,
                    status: "ready",
                    changedKeys: undefined,
                  })
                )
              )
            )
          )
        )
      )
      .handle("submitCheckout", ({ payload, request }) =>
        received("submitCheckout", payload, request.headers).pipe(
          Effect.andThen(
            answer("submitCheckout", (scripted) =>
              submitCheckout({
                booking,
                payload,
                remembered: request.headers[customerReferralCodeHeader],
                scripted,
              })
            )
          )
        )
      )
  );
};

const unavailable = (reason: CustomerCheckoutUnavailableReason) =>
  new CustomerCheckoutUnavailable({ reason });

/** The order a token names, unless the token is unknown or its hold ended. */
const held = Effect.fn("FakeBooking.held")(function* (
  booking: FakeBookingApi,
  token: string
) {
  const found = booking.held(token);
  if (found === undefined) return yield* new CustomerCheckoutNotFound();
  if (booking.submitted(found.orderId)) {
    return yield* unavailable("payment_in_progress");
  }
  if (booking.now().getTime() >= found.expiresAt.getTime()) {
    return yield* unavailable("expired");
  }
  return found;
});

/** An answer the fake applies to its own flow. */
type OwnFlowScript =
  | { readonly _tag: "PriceReview"; readonly changedKeys: ChangedKeys }
  | { readonly _tag: "PaymentDisabled" };

/** The changed keys a scripted price change brings, if one is queued. */
const scriptedPriceChange = (scripted: OwnFlowScript | undefined) =>
  Option.fromNullishOr(
    scripted?._tag === "PriceReview" ? scripted.changedKeys : undefined
  );

/** The checkout after its price changed by the scripted keys. */
const priceChanged = (
  checkout: FakeBookingCheckout,
  changedKeys: ChangedKeys
): FakeBookingCheckout => ({
  ...checkout,
  status: "price_review",
  changedKeys,
  surcharge: checkout.surcharge + 50,
});

/** Applies a queued price change, if any. */
const withScriptedPriceChange = (
  checkout: FakeBookingCheckout,
  scripted: OwnFlowScript | undefined
) =>
  Option.match(scriptedPriceChange(scripted), {
    onNone: () => checkout,
    onSome: (changedKeys) => priceChanged(checkout, changedKeys),
  });

/** Stores the checkout's new state and answers it with a new token. */
const answerCheckout = (
  booking: FakeBookingApi,
  checkout: FakeBookingCheckout
) => Effect.sync(() => checkoutAnswer(booking, checkout));

interface CreateCheckoutInput {
  readonly workspace: FakeWorkspace;
  readonly booking: FakeBookingApi;
  readonly payload: CreateCustomerCheckout;
  /** The `x-deskohub-referral-code` header, when sent. */
  readonly remembered: string | undefined;
  readonly scripted: OwnFlowScript | undefined;
}

/**
 * Holds a quoted selection. A retry of the same checkout attempt gets the
 * order that attempt already made, whatever changed since.
 */
const createCheckout = (input: CreateCheckoutInput) =>
  usableAccountLink(input.workspace).pipe(
    Effect.andThen(() =>
      Option.match(
        Option.fromNullishOr(
          input.booking.attempted(
            input.payload.checkoutSessionId,
            input.payload.checkoutAttemptId
          )
        ),
        {
          onSome: (earlier) => answerCheckout(input.booking, earlier),
          onNone: () => holdNewCheckout(input),
        }
      )
    )
  );

/** Account states the Workspace can't book for, with the reason it gives. */
const accountLinkBlocker = (account: CustomerAccountState) =>
  account.kind === "deletion-pending" || account.kind === "support-required"
    ? Option.some(account.kind)
    : Option.none();

const usableAccountLink = (workspace: FakeWorkspace) =>
  Effect.sync(() => accountLinkBlocker(workspace.data.account)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (reason) =>
          Effect.fail(new CustomerAccountLinkRequired({ reason })),
      })
    )
  );

const holdNewCheckout = (input: CreateCheckoutInput) =>
  checkedSelection(input.booking, input.payload.selection).pipe(
    Effect.as(input),
    Effect.filterOrFail(
      ({ booking, payload }) =>
        booking.quoteMatches(payload.advertisedPriceToken, payload.selection),
      () => new CustomerQuoteExpired()
    ),
    Effect.filterOrFail(
      ({ booking, payload }) =>
        !booking.unavailableDates.includes(payload.selection.date),
      () => new CustomerSelectionUnavailable({ reason: "availability_changed" })
    ),
    Effect.flatMap((checked) => Effect.sync(() => startCheckout(checked)))
  );

/** Allocates the order and answers its first checkout state. */
const startCheckout = ({
  booking,
  payload,
  remembered,
  scripted,
}: CreateCheckoutInput): CustomerCheckoutStart => {
  const orderId = booking.nextId("sample-booking-order");
  if (scripted?._tag === "PaymentDisabled") {
    return { status: "payment_disabled", orderId };
  }
  const now = booking.now();
  const checkout: FakeBookingCheckout = withScriptedPriceChange(
    {
      orderId,
      selection: payload.selection,
      locale: payload.locale,
      expiresAt: new Date(now.getTime() + fakeHoldDuration),
      status: "ready",
      changedKeys: undefined,
      surcharge: 0,
      code: undefined,
      // A remembered referral code gives the referral benefit.
      referralApplied: remembered === fakeBookingCodes.referral,
      earlyPerformanceRequired:
        inclusiveDays(pragueToday(now), payload.selection.date) <=
        withdrawalPeriodDays,
    },
    scripted
  );
  booking.attempt(
    payload.checkoutSessionId,
    payload.checkoutAttemptId,
    orderId
  );
  // Any other remembered code counts as used up, so the app forgets it.
  const usedUp =
    remembered !== undefined && remembered !== fakeBookingCodes.referral;
  return {
    ...checkoutAnswer(booking, checkout),
    ...(usedUp ? { rememberedReferralCodeUsed: true as const } : {}),
  };
};

interface DiscountCodeInput {
  readonly booking: FakeBookingApi;
  readonly payload: typeof ApplyCustomerCheckoutDiscountCode.Type;
  readonly scripted: OwnFlowScript | undefined;
}

/** How the fake treats an entered code. */
const codeKind = (code: string) => {
  if (code === fakeBookingCodes.expiredWithReplacement) return "replaced";
  return code === fakeBookingCodes.discount ||
    code === fakeBookingCodes.free ||
    code === fakeBookingCodes.referral
    ? "known"
    : "unknown";
};

/** Applies a code to a held checkout that has no code and no pending review. */
const applyDiscountCode = ({ booking, payload, scripted }: DiscountCodeInput) =>
  Effect.Do.pipe(
    Effect.bind("current", () => held(booking, payload.payStateToken)),
    Effect.let("code", () => payload.code.trim().toUpperCase()),
    Effect.filterOrFail(
      ({ current }) => current.status !== "price_review",
      () => unavailable("price_review_pending")
    ),
    Effect.filterOrFail(
      ({ current }) => current.code === undefined,
      () => new CustomerDiscountCodeRejected({ reason: "code_already_applied" })
    ),
    Effect.flatMap(({ current, code }) =>
      Match.value(codeKind(code)).pipe(
        Match.when("replaced", () => rejectWithReplacement(booking, current)),
        Match.when("unknown", () =>
          Effect.fail(
            new CustomerDiscountCodeRejected({ reason: "unavailable" })
          )
        ),
        Match.when("known", () =>
          Effect.sync(() => codeAnswer({ booking, current, code, scripted }))
        ),
        Match.exhaustive
      )
    )
  );

/** Rejects the code but signs a replacement pay state that keeps it. */
const rejectWithReplacement = (
  booking: FakeBookingApi,
  current: FakeBookingCheckout
) =>
  Effect.sync(() => booking.hold(current)).pipe(
    Effect.flatMap((payStateToken) =>
      Effect.fail(
        new CustomerDiscountCodeRejected({
          reason: "unavailable",
          payStateToken,
          expiresAt: current.expiresAt.toISOString(),
        })
      )
    )
  );

/**
 * A known code's answer: applied, or, when the price changed first, the
 * reviewed checkout without the code.
 */
const codeAnswer = ({
  booking,
  current,
  code,
  scripted,
}: {
  readonly booking: FakeBookingApi;
  readonly current: FakeBookingCheckout;
  readonly code: string;
  readonly scripted: OwnFlowScript | undefined;
}): CustomerCheckoutDiscountCodeResult =>
  Option.match(scriptedPriceChange(scripted), {
    onSome: (changedKeys) =>
      checkoutAnswer(booking, priceChanged(current, changedKeys)),
    onNone: () => ({
      ...checkoutAnswer(booking, {
        ...current,
        code,
        referralApplied:
          current.referralApplied || code === fakeBookingCodes.referral,
      }),
      ...(code === fakeBookingCodes.referral
        ? {
            discountCode: "referral_accepted" as const,
            rememberReferralCode: fakeBookingCodes.referral,
          }
        : { discountCode: "applied" as const }),
    }),
  });

interface SubmitCheckoutInput {
  readonly booking: FakeBookingApi;
  readonly payload: typeof SubmitCustomerCheckout.Type;
  readonly remembered: string | undefined;
  readonly scripted: OwnFlowScript | undefined;
}

/** Submits a held checkout, unless a scripted price change comes first. */
const submitCheckout = (input: SubmitCheckoutInput) =>
  held(input.booking, input.payload.payStateToken).pipe(
    Effect.flatMap((current) =>
      Option.match(scriptedPriceChange(input.scripted), {
        onSome: (changedKeys) =>
          answerCheckout(input.booking, priceChanged(current, changedKeys)),
        onNone: () => submitHeld({ ...input, current }),
      })
    )
  );

/** Checks the price and consents, then starts the payment. */
const submitHeld = ({
  booking,
  payload,
  remembered,
  current,
}: SubmitCheckoutInput & { readonly current: FakeBookingCheckout }) =>
  Effect.succeed(current).pipe(
    Effect.filterOrFail(
      (checkout) => checkout.status !== "price_review",
      () => unavailable("price_review_pending")
    ),
    Effect.filterOrFail(
      () => payload.legalConsent,
      () => new CustomerConsentRequired({ consent: "legal" })
    ),
    Effect.filterOrFail(
      (checkout) =>
        acceptsCurrentDocuments(
          sampleLegalDocuments(checkout.locale, booking.legalVersion),
          payload.acceptedLegalDocuments
        ),
      () => new CustomerLegalDocumentsChanged()
    ),
    Effect.filterOrFail(
      (checkout) =>
        !checkout.earlyPerformanceRequired ||
        payload.earlyPerformanceConsent === true,
      () => new CustomerConsentRequired({ consent: "early_performance" })
    ),
    Effect.tap((checkout) => Effect.sync(() => booking.submit(checkout))),
    Effect.map((checkout) =>
      submission(booking, checkout, remembered, payload.returnTarget)
    )
  );

const acceptsCurrentDocuments = (
  documents: ReadonlyArray<{ readonly key: string; readonly hash: string }>,
  accepted: ReadonlyArray<{ readonly key: string; readonly hash: string }>
) =>
  documents.every((document) =>
    accepted.some(
      (sent) => sent.key === document.key && sent.hash === document.hash
    )
  );

/**
 * What a submitted checkout answers: pay, or nothing left to pay. The status
 * page is the one the submission's return target names, as #1021 serves it.
 */
const submission = (
  booking: FakeBookingApi,
  checkout: FakeBookingCheckout,
  remembered: string | undefined,
  returnTarget: (typeof SubmitCustomerCheckout.Type)["returnTarget"]
): CustomerCheckoutSubmission => {
  const statusUrl = statusUrlFor(checkout.orderId, returnTarget);
  if (summaryOf(checkout).total.value === 0) {
    return {
      status: "paid",
      orderId: checkout.orderId,
      statusUrl,
      ...(remembered === undefined
        ? {}
        : { rememberedReferralCodeUsed: true as const }),
    };
  }
  return {
    status: "payment_required",
    orderId: checkout.orderId,
    paymentUrl: booking.paymentPage(checkout.orderId),
    statusUrl,
  };
};

/** How a submitted order stands in the Workspace's reservations. */
type BookedStatus = "pending" | "fulfilled";

const bookedStates = {
  pending: {
    status: "pending",
    paymentStatus: "pending",
    fulfillmentStatus: "not_started",
  },
  fulfilled: {
    status: "fulfilled",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
  },
} as const;

const bookedRowStatuses = {
  pending: "pending",
  fulfilled: "confirmed",
} as const;

const accessMargin = 30 * 60_000;

/**
 * A submitted order as the status page and the history read it, shaped like
 * the sample fixtures' orders: a fulfilled one has its door code, and an
 * invoice unless it was free.
 */
const bookedReservation = (
  checkout: FakeBookingCheckout,
  total: Money,
  status: BookedStatus
): {
  readonly order: SampleOrder;
  readonly row: CustomerReservationSummary;
} => {
  const { selection } = checkout;
  const { startsAt, endsAt } = bookedTimes(selection);
  const orderId = CustomerReservationOrderId.make(checkout.orderId);
  const fulfilled = status === "fulfilled";
  return {
    order: {
      state: {
        orderId,
        kind: selection.family,
        ...bookedStates[status],
        startsAt,
        endsAt,
        total,
      },
      ...(fulfilled
        ? {
            access: {
              code: "000000",
              accessStartsAt: new Date(
                Date.parse(startsAt) - accessMargin
              ).toISOString(),
              accessEndsAt: new Date(
                Date.parse(endsAt) + accessMargin
              ).toISOString(),
            },
          }
        : {}),
      ...(fulfilled && total.value > 0 ? { invoice: sampleInvoicePdf() } : {}),
    },
    row: {
      id: `sample-reservation-${checkout.orderId}`,
      orderId,
      product:
        selection.family === "cowork"
          ? { kind: "cowork", tier: selection.tier ?? "open-space" }
          : { kind: selection.family },
      startsAt,
      endsAt,
      seats:
        selection.family === "meeting-room" ? null : (selection.seats ?? 1),
      status: bookedRowStatuses[status],
    },
  };
};

/**
 * When a selection's reservation runs: a meeting room's hourly slot, else
 * whole Prague days (23 or 25 hours across a daylight-saving change) through
 * the last booked date.
 */
const bookedTimes = (selection: CustomerBookingSelection) => {
  if (selection.family === "meeting-room" && selection.duration !== "day:1") {
    const { length } = meetingRoomSlots[selection.duration ?? "hour:1"];
    const startsAt = pragueInstant(
      selection.date,
      selection.startTime ?? "00:00"
    );
    return {
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + length * 3_600_000).toISOString(),
    };
  }
  const lastDate =
    selection.family === "office"
      ? (selection.endDate ?? selection.date)
      : selection.date;
  return {
    startsAt: pragueMidnight(selection.date).toISOString(),
    endsAt: pragueMidnight(addDays(lastDate, 1)).toISOString(),
  };
};

const statusUrlFor = (
  orderId: string,
  returnTarget: (typeof SubmitCustomerCheckout.Type)["returnTarget"]
) =>
  Match.value(returnTarget).pipe(
    Match.when(
      "native-app",
      () => `deskohub://reservations/${orderId}?after=payment`
    ),
    Match.when(
      "web-app",
      () => `${fakeWorkspaceOrigin}/app/reservations/${orderId}?after=payment`
    ),
    Match.when(
      undefined,
      () => `${fakeWorkspaceOrigin}/reservation/status?orderId=${orderId}`
    ),
    Match.exhaustive
  );

/** The share of the price the code or the referral benefit takes off. */
const discountShare = ({ code, referralApplied }: FakeBookingCheckout) => {
  if (code === fakeBookingCodes.free) return 1;
  return code !== undefined || referralApplied ? 0.1 : 0;
};

const summaryOf = (checkout: FakeBookingCheckout) =>
  sampleSummary({
    lines: pricedLines(checkout.selection),
    discountShare: discountShare(checkout),
    discountLabel: checkout.code ?? fakeBookingCodes.referral,
    surcharge: checkout.surcharge,
  });

/** Stores the checkout and answers it with a new pay state token. */
const checkoutAnswer = (
  booking: FakeBookingApi,
  checkout: FakeBookingCheckout
): CustomerCheckout => {
  const payStateToken = booking.hold(checkout);
  const requiredFrom = new Date(
    Date.parse(`${checkout.selection.date}T00:00:00Z`) -
      withdrawalPeriodDays * 86_400_000
  );
  return {
    status: checkout.status === "price_review" ? "price_review" : "ready",
    orderId: checkout.orderId,
    payStateToken,
    expiresAt: checkout.expiresAt.toISOString(),
    summary: summaryOf(checkout),
    ...(checkout.changedKeys === undefined
      ? {}
      : { priceReview: { changedKeys: checkout.changedKeys } }),
    earlyPerformanceConsent: {
      required: checkout.earlyPerformanceRequired,
      requiredFrom: requiredFrom.toISOString(),
    },
    ...(checkout.referralApplied ? { referralApplied: true as const } : {}),
  };
};

/** Checks a selection the way the booking pages accept it. */
const checkedSelection = Effect.fn("FakeBooking.checkedSelection")(function* (
  booking: FakeBookingApi,
  selection: CustomerBookingSelection
) {
  const today = booking.today();
  const latest = addDays(today, selection.family === "office" ? 31 : 183);
  if (selection.family === "cowork" && selection.tier === undefined) {
    return yield* new CustomerBookingSelectionInvalid({ field: "tier" });
  }
  if (selection.family === "meeting-room") {
    if (selection.duration === undefined) {
      return yield* new CustomerBookingSelectionInvalid({ field: "duration" });
    }
    if (selection.duration !== "day:1" && selection.startTime === undefined) {
      return yield* new CustomerBookingSelectionInvalid({ field: "startTime" });
    }
  }
  if (selection.family === "office" && booking.officeClosed) {
    return yield* new CustomerOfferingUnavailable({ family: "office" });
  }
  const last = selection.endDate ?? selection.date;
  if (selection.date < today || last > latest || last < selection.date) {
    return yield* new CustomerBookingDateOutOfRange({
      earliest: today,
      latest,
    });
  }
});

type AvailabilityQuery = HttpApiEndpoint.Query<
  Endpoint<"getAvailability">
>["Type"];

const availability = (
  booking: FakeBookingApi,
  query: AvailabilityQuery
): Effect.Effect<CustomerAvailability, CustomerBookingSelectionInvalid> =>
  Effect.suspend(() => {
    const today = booking.today();
    const from = query.from ?? today;
    const to = query.to ?? addDays(today, 183);
    if (to < from) {
      return Effect.fail(new CustomerBookingSelectionInvalid({ field: "to" }));
    }
    const inRange = (date: string) => date >= from && date <= to;
    const startDate = query.startsAt?.slice(0, 10);
    const endDate = query.endsAt?.slice(0, 10) ?? startDate;
    const blocked = (date: string | undefined) =>
      date !== undefined && booking.unavailableDates.includes(date);
    const officeBlocked =
      startDate !== undefined &&
      endDate !== undefined &&
      booking.unavailableDates.some(
        (date) => date >= startDate && date <= endDate
      );
    const answer: CustomerAvailability = {
      ...(query.date === undefined ? {} : { date: query.date }),
      from,
      to,
      unavailableDates: booking.unavailableDates.filter(inRange),
      reservedDeskWorkstationRequiredDates:
        booking.workstationRequiredDates.filter(inRange),
      unavailableCoworkTiers:
        query.date === undefined
          ? []
          : [...(booking.unavailableTiers.get(query.date) ?? [])],
      meetingRoomUnavailable: blocked(startDate),
      officeUnavailable: booking.officeClosed || officeBlocked,
      unavailableMonitorOptions: [...booking.unavailableMonitorOptions],
      notices: [],
    };
    return Effect.succeed(answer);
  });

const meetingRoomStartTimes = (
  booking: FakeBookingApi,
  date: string,
  duration: CustomerMeetingRoomDuration
) => {
  const { hours, length } = meetingRoomSlots[duration];
  return {
    date,
    duration,
    startTimes: booking.unavailableDates.includes(date)
      ? []
      : hours.map((hour) => {
          const time = `${hour.toString().padStart(2, "0")}:00`;
          const startsAt = pragueInstant(date, time);
          return {
            startDateTime: `${date}T${time}`,
            startsAt,
            endsAt: new Date(
              Date.parse(startsAt) + length * 3_600_000
            ).toISOString(),
            // No room to set up before opening, nor before the 12:00 slot.
            earlySetupAvailable: hour !== 8 && hour !== 12,
          };
        }),
  };
};

/** The start hours each duration is offered at, and its length in hours. */
const meetingRoomSlots: Record<
  CustomerMeetingRoomDuration,
  { readonly hours: ReadonlyArray<number>; readonly length: number }
> = {
  "hour:1": { hours: range(8, 17), length: 1 },
  "hour:4": { hours: range(8, 14), length: 4 },
  "day:1": { hours: [0], length: 24 },
};

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

type SelectionQuery = Omit<typeof CustomerBookingSelectionQuery.Type, "locale">;

/** The selection a quote's query string names. */
const selectionOfQuery = ({
  coffee,
  ...fields
}: SelectionQuery): CustomerBookingSelection => ({
  ...fields,
  ...(coffee === undefined ? {} : { coffee: coffee === "true" }),
});

/** A short FNV-1a hash in hex, for tokens that look signed. */
const fnv1a = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** The instant Prague's wall clock shows `time` (HH:MM) on `date`. */
const pragueInstant = (date: PragueDate, time: string) => {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const wanted = hour * 60 + minute;
  const guess = pragueMidnight(date).getTime() + wanted * 60_000;
  // Across a daylight-saving change the day's hours shift by the change.
  const shown = pragueDateTimeAt(new Date(guess));
  const drift = shown.hour * 60 + shown.minute - wanted;
  return new Date(guess - drift * 60_000).toISOString();
};
