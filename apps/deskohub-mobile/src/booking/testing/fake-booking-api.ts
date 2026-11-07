import {
  CustomerAccountLinkRequired,
  type CustomerAvailability,
  type CustomerBookableCoworkTier,
  type CustomerBookingApi,
  CustomerBookingDateOutOfRange,
  type CustomerBookingSelection,
  CustomerBookingSelectionInvalid,
  type CustomerBookingSelectionQuery,
  type CustomerCheckout,
  type CustomerCheckoutChangedKeys,
  CustomerCheckoutNotFound,
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
  CustomerSelectionUnavailable,
  customerReferralCodeHeader,
  ReferralCode,
  WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
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
  private readonly checkouts = new Map<string, FakeBookingCheckout>();
  private readonly tokens = new Map<string, string>();
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
    return pragueDate(this.now());
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

  /** @internal Stores the order and returns a new pay state token for it. */
  hold(checkout: FakeBookingCheckout) {
    this.checkouts.set(checkout.orderId, checkout);
    const token = `ps1.${fnv1a(checkout.orderId)}.${fnv1a(this.nextId("pay-state"))}`;
    this.tokens.set(token, checkout.orderId);
    return token;
  }

  /** @internal The order a pay state token names. */
  held(token: string) {
    const orderId = this.tokens.get(token);
    return orderId === undefined ? undefined : this.checkouts.get(orderId);
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

  const linkRequired = Effect.suspend(() => {
    const { account } = workspace.data;
    return account.kind === "deletion-pending" ||
      account.kind === "support-required"
      ? Effect.fail(new CustomerAccountLinkRequired({ reason: account.kind }))
      : Effect.void;
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
              Effect.gen(function* () {
                yield* linkRequired;
                yield* checkedSelection(booking, payload.selection);
                if (
                  !booking.quoteMatches(
                    payload.advertisedPriceToken,
                    payload.selection
                  )
                ) {
                  return yield* new CustomerQuoteExpired();
                }
                if (booking.unavailableDates.includes(payload.selection.date)) {
                  return yield* new CustomerSelectionUnavailable({
                    reason: "availability_changed",
                  });
                }
                const orderId = booking.nextId("sample-booking-order");
                if (scripted?._tag === "PaymentDisabled") {
                  return { status: "payment_disabled" as const, orderId };
                }
                const now = booking.now();
                // A remembered referral code gives the referral benefit; any
                // other remembered code counts as used up, so the app forgets it.
                const remembered = request.headers[customerReferralCodeHeader];
                const checkout: FakeBookingCheckout = {
                  orderId,
                  selection: payload.selection,
                  locale: payload.locale,
                  expiresAt: new Date(now.getTime() + fakeHoldDuration),
                  status: "ready",
                  changedKeys: undefined,
                  surcharge: 0,
                  code: undefined,
                  referralApplied: remembered === fakeBookingCodes.referral,
                  earlyPerformanceRequired:
                    inclusiveDays(pragueDate(now), payload.selection.date) <=
                    withdrawalPeriodDays,
                };
                const held = priceChanged(checkout, scripted);
                return {
                  ...checkoutAnswer(booking, held),
                  ...(remembered !== undefined &&
                  remembered !== fakeBookingCodes.referral
                    ? { rememberedReferralCodeUsed: true as const }
                    : {}),
                };
              })
            )
          )
        )
      )
      .handle("applyCheckoutDiscountCode", ({ payload, request }) =>
        received("applyCheckoutDiscountCode", payload, request.headers).pipe(
          Effect.andThen(
            answer("applyCheckoutDiscountCode", (scripted) =>
              Effect.gen(function* () {
                const current = yield* held(booking, payload.payStateToken);
                const code = payload.code.trim().toUpperCase();
                if (current.code !== undefined) {
                  return yield* new CustomerDiscountCodeRejected({
                    reason: "code_already_applied",
                  });
                }
                if (code === fakeBookingCodes.expiredWithReplacement) {
                  return yield* new CustomerDiscountCodeRejected({
                    reason: "unavailable",
                    payStateToken: booking.hold(current),
                    expiresAt: current.expiresAt.toISOString(),
                  });
                }
                const known =
                  code === fakeBookingCodes.discount ||
                  code === fakeBookingCodes.free ||
                  code === fakeBookingCodes.referral;
                if (!known) {
                  return yield* new CustomerDiscountCodeRejected({
                    reason: "unavailable",
                  });
                }
                if (scripted?._tag === "PriceReview") {
                  // The price changed first: the code isn't applied yet.
                  return checkoutAnswer(
                    booking,
                    priceChanged(current, scripted)
                  );
                }
                const applied: FakeBookingCheckout = {
                  ...current,
                  code,
                  referralApplied:
                    current.referralApplied ||
                    code === fakeBookingCodes.referral,
                };
                return {
                  ...checkoutAnswer(booking, applied),
                  ...(code === fakeBookingCodes.referral
                    ? {
                        discountCode: "referral_accepted" as const,
                        rememberReferralCode: fakeBookingCodes.referral,
                      }
                    : { discountCode: "applied" as const }),
                };
              })
            )
          )
        )
      )
      .handle("acceptCheckoutPriceChange", ({ payload, request }) =>
        received("acceptCheckoutPriceChange", payload, request.headers).pipe(
          Effect.andThen(
            answer("acceptCheckoutPriceChange", () =>
              Effect.map(
                held(booking, payload.payStateToken),
                (current): CustomerCheckout =>
                  checkoutAnswer(booking, {
                    ...current,
                    status: "ready",
                    changedKeys: undefined,
                  })
              )
            )
          )
        )
      )
      .handle("submitCheckout", ({ payload, request }) =>
        received("submitCheckout", payload, request.headers).pipe(
          Effect.andThen(
            answer("submitCheckout", (scripted) =>
              Effect.gen(function* () {
                const current = yield* held(booking, payload.payStateToken);
                if (scripted?._tag === "PriceReview") {
                  return checkoutAnswer(
                    booking,
                    priceChanged(current, scripted)
                  );
                }
                if (current.status === "price_review") {
                  return yield* unavailable("price_review_pending");
                }
                if (!payload.legalConsent) {
                  return yield* new CustomerConsentRequired({
                    consent: "legal",
                  });
                }
                const documents = sampleLegalDocuments(
                  current.locale,
                  booking.legalVersion
                );
                const accepted = documents.every((document) =>
                  payload.acceptedLegalDocuments.some(
                    (sent) =>
                      sent.key === document.key && sent.hash === document.hash
                  )
                );
                if (!accepted) {
                  return yield* new CustomerLegalDocumentsChanged();
                }
                if (
                  current.earlyPerformanceRequired &&
                  payload.earlyPerformanceConsent !== true
                ) {
                  return yield* new CustomerConsentRequired({
                    consent: "early_performance",
                  });
                }
                booking.hold({ ...current, status: "submitted" });
                const statusUrl = `${fakeWorkspaceOrigin}/reservation/status?orderId=${current.orderId}`;
                const remembered = request.headers[customerReferralCodeHeader];
                return summaryOf(current).total.value === 0
                  ? {
                      status: "paid" as const,
                      orderId: current.orderId,
                      statusUrl,
                      ...(remembered === undefined
                        ? {}
                        : { rememberedReferralCodeUsed: true as const }),
                    }
                  : {
                      status: "payment_required" as const,
                      orderId: current.orderId,
                      paymentUrl: `https://pay.sample.example/checkout/${current.orderId}`,
                      statusUrl,
                    };
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
  if (found.status === "submitted") {
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

const priceChanged = (
  checkout: FakeBookingCheckout,
  scripted: OwnFlowScript | undefined
): FakeBookingCheckout =>
  scripted?._tag === "PriceReview"
    ? {
        ...checkout,
        status: "price_review",
        changedKeys: scripted.changedKeys,
        surcharge: checkout.surcharge + 50,
      }
    : checkout;

/** The share of the price a code takes off. */
const codeShare = (code: string | undefined) => {
  if (code === undefined) return 0;
  return code === fakeBookingCodes.free ? 1 : 0.1;
};

const summaryOf = (checkout: FakeBookingCheckout) =>
  sampleSummary({
    lines: pricedLines(checkout.selection),
    discountShare: codeShare(checkout.code),
    discountLabel: checkout.code ?? "",
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

const selectionKey = (selection: CustomerBookingSelection) =>
  JSON.stringify(
    Object.entries(selection)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
  );

/** A short FNV-1a hash in hex, for tokens that look signed. */
const fnv1a = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const pragueParts = (instant: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );

/** The Prague calendar date of an instant. */
const pragueDate = (instant: Date) => {
  const parts = pragueParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** The instant of a Prague local date and time. */
const pragueInstant = (date: string, time: string) => {
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  const parts = pragueParts(new Date(asUtc));
  const shown = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`
  );
  return new Date(asUtc - (shown - asUtc)).toISOString();
};
