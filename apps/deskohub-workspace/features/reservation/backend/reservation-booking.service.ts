import { DotyposService } from "@deskohub/dotypos";
import { EmailRecipientDomainService } from "@deskohub/email/backend/recipient-domain.service";
import { parsePhoneNumber } from "@deskohub/phone-number";
import {
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  Ref,
  Schema,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  CustomerAccountAccessError,
  CustomerAccountContactService,
  CustomerAccountSections,
} from "@/features/account";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import type { CustomerAccountSession } from "@/features/account/backend/customer-authentication.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { CheckoutAnalytics } from "@/features/checkout/backend/analytics";
import {
  buildCheckoutPayPath,
  buildSignedPayState,
  CheckoutPricingService,
  type PayStateLinkOptions,
  sealPayStateForUrl,
} from "@/features/checkout/backend/checkout";
import {
  deriveCheckoutAttemptKeys,
  deriveCheckoutSessionKeys,
} from "@/features/checkout/backend/checkout/checkout-lookup-keys.server";
import { splitCustomerName } from "@/features/checkout/backend/reservation";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import {
  addCheckoutReferralAppliedMarker,
  hasCheckoutReferralBenefit,
} from "@/features/checkout/checkout-referral-notice";
import {
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { legalEvidenceMapSchema } from "@/features/checkout/legal-evidence";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import type { CanonicalPromotionCode } from "@/features/discounts/contracts";
import { defaultPhoneRegion, type Locale, m } from "@/features/i18n";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
import { mirrorDeviceAnalyticsConsent } from "@/features/legal/backend/analytics-consent-mirror";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import type { MarketingConsentGrantSource } from "@/features/legal/marketing-consent-grant-source";
import {
  ensureOfficeReservationsEnabled,
  OfficeReleaseGate,
} from "@/features/office/backend/office-release-gate";
import { ReferralService } from "@/features/referrals";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import {
  RememberedReferral,
  type RememberedReferralForBooking,
} from "@/features/referrals/remembered-referral.service";
import {
  getPreparedCoworkCheckoutDetails,
  type PreparedCoworkAdvertisement,
  type PreparedCoworkPayState,
  prepareCoworkAdvertisement,
} from "@/features/reservation/actions/prepare-cowork-pay-state";
import {
  getPreparedMeetingRoomCheckoutDetails,
  type PreparedMeetingRoomAdvertisement,
  type PreparedMeetingRoomPayState,
  prepareMeetingRoomAdvertisement,
} from "@/features/reservation/actions/prepare-meeting-room-pay-state";
import {
  getPreparedOfficeCheckoutDetails,
  type PreparedOfficeAdvertisement,
  type PreparedOfficePayState,
  prepareOfficeAdvertisement,
} from "@/features/reservation/actions/prepare-office-pay-state";
import type { PreparePayStateInput } from "@/features/reservation/actions/prepare-pay-state.schema";
import {
  AgentBookingPaymentInProgressError,
  AgentBookingProfileRequiredError,
  BookingAgent,
} from "@/features/reservation/backend/booking-agent";
import {
  getAgentHoldBookedAt,
  getDotyposCustomerId,
  type ReservationHold,
  ReservationHolds,
} from "@/features/reservation/backend/reservation-holds.service";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationPrePaymentOutcome } from "@/features/reservation/reservation-analytics";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { getReservationCustomerProfile } from "@/features/reservation/reservation-customer-profile";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { catchRecoverableCause } from "@/shared/backend/workspace-effect";
import { currentRequestHeaders } from "@/shared/backend/workspace-request-context";
import {
  currentInstant,
  instantStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";

/**
 * One submission a server caller prepares Pay for. Beside the site's tools,
 * the customer HTTP API labels a grant from the customer's native app; the
 * site's schema keeps accepting only the site's tools.
 */
export type PayStateSubmission = Omit<
  PreparePayStateInput,
  "marketingConsentSource"
> & {
  readonly marketingConsentSource?: Extract<
    MarketingConsentGrantSource,
    "site_tool" | "customer_app"
  >;
};

/** The services each caller provides per request for its own channel. */
type ChannelServices =
  | CustomerAccountSections
  | CurrentCustomerAccount
  | CustomerAccountContactService
  | RememberedReferral;

interface IReservationBooking {
  /**
   * Prepares the Pay page for one submission: the shared booking operation
   * of the reservation form's Server Action, the customer MCP server and the
   * customer HTTP API. Each caller authenticates its own channel first, the
   * form with BotID, the MCP server with the agent's OAuth token and the
   * HTTP API with the app session, and provides the account services for
   * that authentication. A booking the MCP server makes carries its
   * {@link BookingAgent}.
   */
  readonly book: (
    submission: PayStateSubmission
  ) => Effect.Effect<
    Effect.Success<ReturnType<typeof bookSubmission>>,
    Effect.Error<ReturnType<typeof bookSubmission>>,
    ChannelServices
  >;
}

/**
 * The capabilities booking uses beside the channel's, captured when the
 * service is built. Only these are captured, so a call keeps its own log
 * annotations, spans and request references.
 */
const bookingCapabilities = [
  ReservationHolds,
  CheckoutAnalytics,
  CheckoutPricingService,
  DotyposService,
  EmailRecipientDomainService,
  MarketingConsentLedger,
  AnalyticsConsentLedger,
  ReviewAccounts,
  ReviewSandbox,
  SealedStateKeys,
  ReferralReleaseGate,
  OfficeReleaseGate,
] as const;

type BookingCapabilities =
  | ReservationHolds
  | CheckoutAnalytics
  | CheckoutPricingService
  | DotyposService
  | EmailRecipientDomainService
  | MarketingConsentLedger
  | AnalyticsConsentLedger
  | ReviewAccounts
  | ReviewSandbox
  | SealedStateKeys
  | ReferralReleaseGate
  | OfficeReleaseGate;

/** Reservation submissions, booked into a hold and a Pay page. */
export class ReservationBooking extends Context.Service<
  ReservationBooking,
  IReservationBooking
>()("ReservationBooking") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const context = Context.pick(...bookingCapabilities)(
        yield* Effect.context<BookingCapabilities>()
      );
      return ReservationBooking.of({
        book: (submission) =>
          bookSubmission(submission).pipe(Effect.provideContext(context)),
      });
    })
  );

  /**
   * The live booking, with the referral and office release gates left to the
   * caller: a request that decides them once, such as the customer HTTP API,
   * passes the gates it built, so booking shares that request's decisions.
   */
  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        ReservationHolds.Live,
        Layer.mergeAll(
          MarketingConsentLedger.Default,
          AnalyticsConsentLedger.Default,
          ReviewAccounts.Default,
          ReviewSandbox.Default
        ).pipe(Layer.provide(WorkspaceDatabase.Default)),
        EmailRecipientDomainService.Live,
        CheckoutAnalytics.Live,
        WorkspaceDotyposLayer,
        CheckoutPricingService.Live,
        ReferralService.Live,
        SealedStateKeys.Default
      )
    )
  );
}

/** {@link ReservationBooking}'s `book`, for one submission. */
export const prepareWorkspacePayState = (submission: PayStateSubmission) =>
  ReservationBooking.pipe(
    Effect.flatMap((booking) => booking.book(submission))
  );

const decodeLegalEvidenceMap = Schema.decodeUnknownSync(
  legalEvidenceMapSchema,
  {
    onExcessProperty: "error",
  }
);
const emptyLegalEvidence = decodeLegalEvidenceMap({});

type PreparedAdvertisement =
  | PreparedCoworkAdvertisement
  | PreparedMeetingRoomAdvertisement
  | PreparedOfficeAdvertisement;

const prepareAdvertisement = Effect.fn("preparePayState.prepareAdvertisement")(
  (
    // Advertising prices the selection; it never reads the consent label.
    input: Omit<PayStateSubmission, "marketingConsentSource"> & {
      readonly bookedAt: Temporal.Instant;
    }
  ) =>
    Match.value(input.reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: (reservation) =>
          prepareCoworkAdvertisement({ ...input, reservation }),
        "meeting-room": (reservation) =>
          prepareMeetingRoomAdvertisement({ ...input, reservation }),
        office: (reservation) =>
          prepareOfficeAdvertisement({ ...input, reservation }),
      })
    )
);

const quotePreparedReservation = Effect.fn(
  "preparePayState.quotePreparedReservation"
)(function* (input: {
  readonly advertisement: PreparedAdvertisement;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly referralCodePrefill: CanonicalPromotionCode | undefined;
  readonly referralCode: CanonicalPromotionCode | undefined;
}) {
  const pricing = yield* CheckoutPricingService;
  const referral =
    input.referralCode === undefined
      ? {}
      : { referralCode: input.referralCode };

  const prepared = yield* pricing.quoteForCustomer({
    ...input.advertisement,
    dotyposCustomerId: input.dotyposCustomerId,
    locale: input.locale,
    affirmedAdvertisement: input.advertisement.discountQuote,
    ...referral,
  });
  const advertisedSummary = Match.value(input.advertisement).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (advertisement) =>
        getCoworkCheckoutSummary(
          advertisement.reservation,
          advertisement.advertisedQuote
        ),
      "meeting-room": (advertisement) =>
        getMeetingRoomCheckoutSummary(advertisement.advertisedQuote),
      office: (advertisement) =>
        getOfficeCheckoutSummary(advertisement.advertisedQuote),
    })
  );
  const preparedSummary = Match.value(prepared).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (customerQuote) =>
        getCoworkCheckoutSummary(
          customerQuote.reservation,
          customerQuote.quote
        ),
      "meeting-room": (customerQuote) =>
        getMeetingRoomCheckoutSummary(customerQuote.quote),
      office: (customerQuote) => getOfficeCheckoutSummary(customerQuote.quote),
    })
  );
  const changedKeys =
    input.advertisement.changedKeys || prepared.advertisedPriceChanged
      ? getCheckoutSummaryChangedKeys(advertisedSummary, preparedSummary)
      : undefined;

  return {
    ...prepared,
    ...referral,
    requestedDiscountCode:
      input.advertisement.requestedDiscountCode ?? input.referralCodePrefill,
    changedKeys,
  };
});

type PreparedPayState =
  | PreparedCoworkPayState
  | PreparedMeetingRoomPayState
  | PreparedOfficePayState;

const getReservationCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly prepared: PreparedPayState;
  readonly legalEvidence: CheckoutDetails["legal"];
}): CheckoutDetails =>
  Match.value(input.prepared).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (prepared) =>
        getPreparedCoworkCheckoutDetails({ ...input, prepared }),
      "meeting-room": (prepared) =>
        getPreparedMeetingRoomCheckoutDetails({ ...input, prepared }),
      office: (prepared) =>
        getPreparedOfficeCheckoutDetails({ ...input, prepared }),
    })
  );

const toReadyResult = Effect.fn("preparePayState.toReadyResult")(
  function* (input: {
    readonly locale: Locale;
    readonly prepared: PreparedPayState;
    readonly reservationId: WorkspaceReservationId;
    readonly checkoutSessionId: CheckoutSessionId;
    readonly bookedAt: Temporal.Instant;
    readonly changedKeys?: CheckoutSummaryChangedKeys;
    /**
     * The customer the quote was priced for, when the booking carries the
     * remembered referral: the result reports the referral applied only when
     * the Pay state holds that customer's invitation benefit.
     */
    readonly referralCustomer?: DotyposCustomerId;
    /**
     * Issues the Pay state as of `bookedAt` and seals it deterministically,
     * so rebuilding it for the same hold returns the same link.
     */
    readonly stableLink?: boolean;
  }) {
    const linkOptions: PayStateLinkOptions = input.stableLink
      ? { issuedAt: input.bookedAt, deterministic: true }
      : {};
    const state = yield* buildSignedPayState(
      {
        ...input.prepared,
        locale: input.locale,
        orderId: input.reservationId,
        bookedAt: instantStringSchema.make(
          temporalInstantToIsoString(input.bookedAt)
        ),
        checkoutSessionId: input.checkoutSessionId,
        changedKeys: input.changedKeys,
      },
      linkOptions
    );
    const sealedState = yield* sealPayStateForUrl(state, linkOptions);
    const redirectUrl = buildCheckoutPayPath(input.locale, sealedState, {
      orderId: input.reservationId,
    });
    // The Pay page accepts its sealed state until this instant.
    const expiresAt = temporalInstantToIsoString(
      Temporal.Instant.fromEpochMilliseconds(state.exp * 1000)
    );
    const referralApplied =
      input.referralCustomer !== undefined &&
      hasCheckoutReferralBenefit({
        discounts: state.quote.payment.discounts,
        dotyposCustomerId: input.referralCustomer,
      });
    const issued = {
      orderId: input.reservationId,
      redirectUrl,
      payStateToken: sealedState.token,
      expiresAt,
      ...(referralApplied && { referralApplied: true as const }),
    };

    if (input.changedKeys) {
      return {
        status: "pricing_changed" as const,
        ...issued,
        affectedProductKeys: input.changedKeys.itemKeys.flatMap((key) =>
          key.startsWith("product:") ? [key] : []
        ),
      };
    }

    return { status: "ready" as const, ...issued };
  }
);

/**
 * The account a reservation booked "as the account" belongs to: the linked
 * Dotypos customer and the contact the reservation must carry. An account
 * without a profile yet saves the submitted contact and billing as its
 * profile first, except through a customer agent: the customer completes
 * the profile on the site. It runs inside the account section, so
 * completing the profile reuses that hold instead of taking the account lock
 * again.
 */
const resolveAccountCustomer = Effect.fn(
  "preparePayState.resolveAccountCustomer"
)(function* ({
  input,
  bookingAgent,
}: {
  readonly input: PayStateSubmission;
  readonly bookingAgent: Option.Option<BookingAgent["Service"]>;
}) {
  if (input.customer !== "account") return undefined;

  const contacts = yield* CustomerAccountContactService;
  // The stored link only: booking never claims, reactivates, or asks Dotypos
  // through this read.
  const standing = yield* CurrentCustomerAccount.pipe(
    Effect.flatMap((current) => current.peek)
  );
  const completeProfile = ({ session }: { session: CustomerAccountSession }) =>
    Option.isSome(bookingAgent)
      ? Effect.fail(new AgentBookingProfileRequiredError({}))
      : contacts.completeProfile(
          session,
          getReservationCustomerProfile(
            input.reservation,
            defaultPhoneRegion(input.locale)
          )
        );
  const contact = yield* Match.value(standing).pipe(
    Match.discriminatorsExhaustive("kind")({
      "signed-out": () => Effect.succeed(null),
      "deletion-pending": () => Effect.succeed(null),
      unverified: () =>
        Effect.fail(
          new CustomerAccountAccessError({ reason: "unverified-email" })
        ),
      unlinked: completeProfile,
      // A review account has no link, so it reads as unlinked; the section
      // books it in the review sandbox before this read.
      review: completeProfile,
      linked: ({ account, session }) =>
        contacts.linkedContact({ ...account, email: session.email }),
      unavailable: ({ failure }) => Effect.fail(failure),
    })
  );
  if (!contact) {
    return yield* standing.kind === "linked" && Option.isSome(bookingAgent)
      ? new AgentBookingProfileRequiredError({})
      : new CustomerAccountAccessError({ reason: "unauthenticated" });
  }
  if (!contact.phone && Option.isSome(bookingAgent)) {
    return yield* new AgentBookingProfileRequiredError({});
  }

  return {
    dotyposCustomerId: contact.dotyposCustomerId,
    contact: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone ?? input.reservation.phone,
    },
  };
});

class UndeliverableContactEmailError extends Data.TaggedError(
  "UndeliverableContactEmailError"
)<Record<string, never>> {}

/**
 * The confirmation and access link go to the contact email, so a domain that
 * cannot receive mail would leave a paid customer without them. Rejects only a
 * definitive DNS answer; an inconclusive lookup lets the booking continue.
 */
const ensureContactEmailAcceptsMail = Effect.fn(
  "preparePayState.ensureContactEmailAcceptsMail"
)(function* (email: string) {
  const domains = yield* EmailRecipientDomainService;
  const status = yield* domains.check(email);
  if (status !== "rejects_mail") return;

  yield* Effect.logWarning(
    "Workspace reservation contact email cannot receive mail"
  );
  return yield* new UndeliverableContactEmailError({});
});

/**
 * A review account's booking, priced like any other and held in its sandbox:
 * no Dotypos customer or reservation, no availability check, no payment, and
 * no hold cleanup. The sandbox keeps the advertised price.
 */
const prepareReviewSandboxHold = Effect.fn(
  "preparePayState.prepareReviewSandboxHold"
)(function* ({
  input,
  accountId,
  bookingAgent,
}: {
  readonly input: PayStateSubmission;
  readonly accountId: CustomerAccountId;
  readonly bookingAgent: Option.Option<BookingAgent["Service"]>;
}) {
  const bookedAt = yield* currentInstant;
  const advertisement = yield* prepareAdvertisement({ ...input, bookedAt });
  const sandbox = yield* ReviewSandbox;
  return yield* sandbox.prepareHold({
    accountId,
    locale: input.locale,
    checkoutSessionId: input.checkoutSessionId,
    selection: Option.match(bookingAgent, {
      onNone: () => input.checkoutAttemptId,
      onSome: (agent) => agent.selectionKey,
    }),
    agentClientId: Option.getOrUndefined(
      Option.map(bookingAgent, (agent) => agent.clientId)
    ),
    reservation: advertisement.reservation,
    total: advertisement.advertisedQuote.payment.expectedPrice,
    bookedAt,
  });
});

/** {@link ReservationBooking}'s `book`, with the services it was built with. */
const bookSubmission = Effect.fn("prepareWorkspacePayState")(function* (
  input: PayStateSubmission
) {
  // A review account books in its sandbox, which captures no checkout
  // analytics, whatever the outcome.
  const inReviewSandbox = yield* Ref.make(false);
  const checkoutAnalytics = yield* CheckoutAnalytics;
  const captureOutcome = (outcome: ReservationPrePaymentOutcome) =>
    checkoutAnalytics
      .prePaymentOutcome({
        checkoutAttemptId: input.checkoutAttemptId,
        outcome,
        timestamp: Temporal.Now.instant(),
      })
      .pipe(
        Effect.when(
          Ref.get(inReviewSandbox).pipe(Effect.map((sandboxed) => !sandboxed))
        )
      );

  return yield* prepareSubmission(input, inReviewSandbox).pipe(
    Effect.scoped,
    Effect.tap((result) =>
      Match.value(result).pipe(
        Match.discriminatorsExhaustive("status")({
          error: () => captureOutcome("reservation_conflict"),
          pricing_changed: () => captureOutcome("pricing_changed"),
          ready: () => captureOutcome("prepared"),
        })
      )
    ),
    Effect.tapError((error) =>
      Match.value(error).pipe(
        Match.tag("WorkspaceTableUnavailableError", () =>
          captureOutcome("availability_changed")
        ),
        Match.tag("AdvertisedPriceMismatchError", () =>
          captureOutcome("validation")
        ),
        Match.tag("UndeliverableContactEmailError", () =>
          captureOutcome("validation")
        ),
        Match.tag("CheckoutAttemptUnavailableError", () =>
          captureOutcome("reservation_conflict")
        ),
        Match.tag("AgentBookingProfileRequiredError", () =>
          captureOutcome("validation")
        ),
        Match.tag("AgentBookingPaymentInProgressError", () =>
          captureOutcome("reservation_conflict")
        ),
        Match.orElse(() => captureOutcome("server_error"))
      )
    ),
    Effect.annotateLogs({
      locale: input.locale,
      reservationKind: input.reservation.kind,
    })
  );
});

type AccountCustomer = Effect.Success<
  ReturnType<typeof resolveAccountCustomer>
>;

/**
 * What an account booking carries from the remembered referral, and what a
 * booking for someone else prefills.
 */
const splitReferralForBooking = (referral: RememberedReferralForBooking) => ({
  accountReferral: referral.kind === "carried" ? referral : undefined,
  referralCodePrefill: referral.kind === "prefill" ? referral.code : undefined,
});

/**
 * The Dotypos customer a reservation books: the account's linked customer,
 * else the one the submitted contact finds or creates, its phone read in the
 * region of the `locale` the submission was validated in.
 */
const resolveBookedCustomerId = Effect.fnUntraced(function* (
  accountCustomer: AccountCustomer,
  reservation: Pick<
    PreparePayStateInput["reservation"],
    "name" | "email" | "phone"
  >,
  locale: Locale
) {
  const dotypos = yield* DotyposService;
  return (
    accountCustomer?.dotyposCustomerId ??
    (yield* dotypos
      .findOrCreateCustomer(
        {
          ...splitCustomerName(reservation.name),
          email: reservation.email,
          phone: Option.getOrUndefined(
            parsePhoneNumber(reservation.phone, defaultPhoneRegion(locale))
          ),
        },
        { lookupFields: ["email"] }
      )
      .pipe(Effect.flatMap((customer) => getDotyposCustomerId(customer.id))))
  );
});

/**
 * Records a checked marketing box as an initial grant; an unchecked one
 * records nothing, never a withdrawal.
 */
const recordCheckoutMarketingConsent = Effect.fnUntraced(function* ({
  input,
  bookingAgent,
  dotyposCustomerId,
}: {
  readonly input: PayStateSubmission;
  readonly bookingAgent: Option.Option<BookingAgent["Service"]>;
  readonly dotyposCustomerId: DotyposCustomerId;
}) {
  if (input.marketingConsent !== true) return;
  yield* Effect.gen(function* () {
    const ledger = yield* MarketingConsentLedger;
    yield* ledger.record({
      customerId: dotyposCustomerId,
      locale: input.locale,
      choice: "grant",
      mode: "initial",
      channel: Option.isSome(bookingAgent)
        ? "mcp_tool"
        : (input.marketingConsentSource ?? "reservation_form"),
    });
  }).pipe(
    Effect.tapError((cause) =>
      Effect.logError("Customer marketing consent recording failed", {
        cause,
      })
    )
  );
});

/**
 * Mirrors the booking device's analytics consent choice into the account's
 * ledger. An agent's request carries no device choice, so it mirrors
 * nothing. Any failure, a defect included, is logged and never blocks the
 * booking.
 */
const mirrorBookingDeviceAnalyticsConsent = Effect.fnUntraced(
  function* ({
    locale,
    bookingAgent,
    accountId,
  }: {
    readonly locale: Locale;
    readonly bookingAgent: Option.Option<BookingAgent["Service"]>;
    readonly accountId: CustomerAccountId;
  }) {
    if (Option.isSome(bookingAgent)) return;
    const headers = yield* currentRequestHeaders;
    yield* mirrorDeviceAnalyticsConsent({
      accountId,
      cookieHeader: headers.get("cookie") ?? "",
      locale,
      source: "hydration_mirror",
    });
  },
  catchRecoverableCause((cause) =>
    Effect.logWarning(
      "Analytics consent mirror failed; continuing the booking.",
      { cause }
    )
  )
);

const prepareSubmission = Effect.fn("prepareWorkspacePayState.submission")(
  function* (input: PayStateSubmission, inReviewSandbox: Ref.Ref<boolean>) {
    const bookingAgent = yield* Effect.serviceOption(BookingAgent);
    const accountSections = yield* CustomerAccountSections;
    const rememberedReferral = yield* RememberedReferral;
    const bookedCustomer = yield* Ref.make<DotyposCustomerId | undefined>(
      undefined
    );
    // Whether the account booking carries the remembered referral, which the
    // account section evaluates once it knows the account's customer.
    const carriesAccountReferral = yield* Ref.make(false);

    // The full state-creating section runs inside the account advisory
    // lock: authority is re-checked under the lock and the same lock is
    // held until the section completes, so deletion cannot interleave
    // between the check and the created state. Only a signed-in account
    // books; a session-authority failure fails closed.
    const result = yield* accountSections.withOptionalAccount(
      Effect.fn(function* (accountId) {
        if (!accountId) {
          return yield* new CustomerAccountAccessError({
            reason: "unauthenticated",
          });
        }
        yield* mirrorBookingDeviceAnalyticsConsent({
          locale: input.locale,
          bookingAgent,
          accountId,
        });
        const reviewAccount = yield* ReviewAccounts.pipe(
          Effect.flatMap((accounts) => accounts.isReviewAccount(accountId))
        );
        yield* Ref.set(inReviewSandbox, reviewAccount);
        yield* Match.value(input.reservation).pipe(
          Match.discriminatorsExhaustive("kind")({
            cowork: () => Effect.void,
            "meeting-room": () => Effect.void,
            office: () => ensureOfficeReservationsEnabled,
          })
        );
        if (reviewAccount) {
          return yield* prepareReviewSandboxHold({
            input,
            accountId,
            bookingAgent,
          });
        }

        const accountCustomer = yield* resolveAccountCustomer({
          input,
          bookingAgent,
        });
        // An account booking carries the remembered referral into its first
        // Pay state, so the first quote already prices the invitation; the
        // attribution is recorded only when that order is paid. A booking for
        // someone else gets a usable code as the code box prefill instead.
        const referralForBooking = yield* rememberedReferral.forBooking(
          accountCustomer
            ? { for: "account", customerId: accountCustomer.dotyposCustomerId }
            : { for: "someone-else" }
        );
        const { accountReferral, referralCodePrefill } =
          splitReferralForBooking(referralForBooking);
        yield* Ref.set(carriesAccountReferral, accountReferral !== undefined);
        // The customer whose invitation a carried referral prices, if any.
        const referralCustomerFor = (pricedFor: DotyposCustomerId) =>
          accountReferral === undefined ? undefined : pricedFor;

        const advertiseAt = (at: Temporal.Instant) =>
          prepareAdvertisement({
            ...input,
            ...(accountCustomer && {
              reservation: { ...input.reservation, ...accountCustomer.contact },
            }),
            bookedAt: at,
          });
        // Submission locks the price: calendar sales are evaluated at this
        // booking moment here and at every later checkout re-check.
        const bookedAt = yield* currentInstant;
        const advertisement = yield* advertiseAt(bookedAt);
        const reservation = advertisement.reservation;

        const checkoutSessionKeys = yield* deriveCheckoutSessionKeys(
          input.checkoutSessionId
        );
        const checkoutAttemptKeys = yield* deriveCheckoutAttemptKeys({
          checkoutSessionId: input.checkoutSessionId,
          checkoutAttemptId: input.checkoutAttemptId,
          reservation,
        });
        yield* Effect.annotateLogsScoped({
          locale: input.locale,
          reservationKind: reservation.kind,
          checkoutSessionKey: checkoutSessionKeys.current,
          checkoutAttemptKey: checkoutAttemptKeys.current,
        });
        yield* Effect.logInfo("Workspace reservation submit started");

        const holds = yield* ReservationHolds;

        if (!accountCustomer) {
          yield* ensureContactEmailAcceptsMail(reservation.email);
        }

        const dotyposCustomerId = yield* resolveBookedCustomerId(
          accountCustomer,
          reservation,
          input.locale
        );
        yield* Effect.annotateLogsScoped({ dotyposCustomerId });
        yield* Effect.logDebug(
          "Workspace reservation Dotypos customer resolved"
        );
        yield* Ref.set(bookedCustomer, dotyposCustomerId);

        const billing =
          reservation.billing ?? defaultReservationBillingSelection;
        yield* recordCheckoutMarketingConsent({
          input,
          bookingAgent,
          dotyposCustomerId,
        });

        const prepared = yield* quotePreparedReservation({
          advertisement,
          dotyposCustomerId,
          locale: input.locale,
          referralCodePrefill,
          referralCode: accountReferral?.referralCode,
        });
        yield* Effect.annotateLogsScoped({ quote: prepared.quote });
        yield* Effect.logDebug("Workspace reservation quote built");

        // An agent's hold is anchored at its booking instant, and a repeated
        // request rebuilds its Pay state as of that instant, so the request
        // gets the same Pay link back for as long as the hold lasts.
        const quoteAt = Effect.fn("preparePayState.quoteAt")(function* (
          at: Temporal.Instant,
          customerId: DotyposCustomerId
        ) {
          const anchoredAdvertisement = yield* advertiseAt(at);
          return yield* quotePreparedReservation({
            advertisement: anchoredAdvertisement,
            dotyposCustomerId: customerId,
            locale: input.locale,
            referralCodePrefill,
            referralCode: accountReferral?.referralCode,
          });
        });
        const toHeldResult = Effect.fn("preparePayState.toHeldResult")(
          function* (held: {
            readonly reservation: WorkspaceReservation;
            readonly checkoutSessionId: CheckoutSessionId;
            readonly prepared: typeof prepared;
          }) {
            const holdBookedAt = Option.isSome(bookingAgent)
              ? getAgentHoldBookedAt(held.reservation)
              : null;
            if (!holdBookedAt) {
              return yield* toReadyResult({
                locale: input.locale,
                prepared: held.prepared,
                reservationId: held.reservation.id,
                checkoutSessionId: held.checkoutSessionId,
                bookedAt,
                changedKeys: held.prepared.changedKeys,
                referralCustomer: referralCustomerFor(dotyposCustomerId),
              });
            }

            const anchored = holdBookedAt.equals(bookedAt)
              ? { prepared: held.prepared, pricedFor: dotyposCustomerId }
              : yield* getDotyposCustomerId(
                  held.reservation.dotyposCustomerId
                ).pipe(
                  Effect.flatMap((pricedFor) =>
                    quoteAt(holdBookedAt, pricedFor).pipe(
                      Effect.map((prepared) => ({ prepared, pricedFor }))
                    )
                  )
                );
            return yield* toReadyResult({
              locale: input.locale,
              prepared: anchored.prepared,
              reservationId: held.reservation.id,
              checkoutSessionId: held.checkoutSessionId,
              bookedAt: holdBookedAt,
              changedKeys: anchored.prepared.changedKeys,
              referralCustomer: referralCustomerFor(anchored.pricedFor),
              stableLink: true,
            });
          }
        );

        const keepPendingPayment = Effect.fnUntraced(function* (
          pending: Extract<
            ReservationHold,
            { readonly kind: "payment_pending" }
          >
        ) {
          yield* Effect.logInfo(
            "Workspace reservation with a pending payment kept for a repeated agent request",
            { reservationId: pending.reservation.id }
          );
          const pendingResult = yield* toHeldResult({
            reservation: pending.reservation,
            checkoutSessionId: pending.checkoutSessionId,
            prepared,
          });
          // Re-quoting at the anchor may have outlasted the link.
          if (
            Date.parse(pendingResult.expiresAt) <=
            Temporal.Now.instant().epochMilliseconds
          ) {
            return yield* new AgentBookingPaymentInProgressError({
              reservationId: pending.reservation.id,
            });
          }
          return pendingResult;
        });
        /**
         * The Pay state of a reused hold, quoted for the customer it holds
         * when another request created it.
         */
        const toReusedResult = (
          reused: Extract<ReservationHold, { readonly kind: "reused" }>
        ) =>
          (reused.pricedFor === undefined
            ? Effect.succeed(prepared)
            : quotePreparedReservation({
                advertisement,
                dotyposCustomerId: reused.pricedFor,
                locale: input.locale,
                referralCodePrefill,
                referralCode: accountReferral?.referralCode,
              })
          ).pipe(
            Effect.flatMap((reusedPrepared) =>
              toHeldResult({
                reservation: reused.reservation,
                checkoutSessionId: reused.checkoutSessionId,
                prepared: reusedPrepared,
              })
            )
          );

        const hold = yield* holds.holdForAttempt({
          checkout: {
            sessionId: input.checkoutSessionId,
            attemptId: input.checkoutAttemptId,
          },
          reservation,
          booking: {
            author: accountId,
            customer: dotyposCustomerId,
            locale: input.locale,
            purpose: billing.purpose,
            bookedAt,
            ...Option.match(bookingAgent, {
              onNone: () => ({}),
              onSome: (agent) => ({ agent }),
            }),
          },
          checkoutDetails: getReservationCheckoutDetails({
            locale: input.locale,
            prepared,
            legalEvidence: emptyLegalEvidence,
          }),
        });
        return yield* Match.value(hold).pipe(
          Match.discriminatorsExhaustive("kind")({
            payment_pending: keepPendingPayment,
            reused: toReusedResult,
            contended: () =>
              Effect.succeed({
                status: "error" as const,
                message: m.reservationErrorMessage(
                  {},
                  { locale: input.locale }
                ),
              }),
            created: (created) =>
              toReadyResult({
                locale: input.locale,
                prepared,
                reservationId: created.reservationId,
                checkoutSessionId: created.checkoutSessionId,
                bookedAt,
                changedKeys: prepared.changedKeys,
                referralCustomer: referralCustomerFor(dotyposCustomerId),
                stableLink: Option.isSome(bookingAgent),
              }),
          })
        );
      })
    );

    // Checked after the account lock is released. Booking for someone else
    // checks the booker, never the friend.
    const settlingCustomer = yield* Ref.get(bookedCustomer);
    if (settlingCustomer) {
      yield* rememberedReferral.forgetIfSettled({
        kind: "order",
        paid: false,
        bookedCustomerId: settlingCustomer,
      });
    }

    if (
      !(yield* Ref.get(carriesAccountReferral)) ||
      result.status === "error"
    ) {
      return result;
    }
    return {
      ...result,
      redirectUrl:
        addCheckoutReferralAppliedMarker(result.redirectUrl, input.locale) ??
        result.redirectUrl,
    };
  }
);
