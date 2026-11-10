import { expect, test } from "bun:test";
import {
  customerApiClientHeader,
  customerApiPathPrefix,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer } from "effect";
import {
  testCustomerSession,
  testLinkedAccount,
} from "@/features/account/backend/account-operations.test-utils";
import {
  AccountAvatarReleaseGate,
  PasskeyReleaseGate,
} from "@/features/account/backend/account-release-gates";
import type { AccountReleaseLayers } from "@/features/account/backend/account-state-capabilities";
import { AnalyticsPersonAnonymisation } from "@/features/account/backend/analytics-person-anonymisation";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import { CustomerRequestOrigins } from "@/features/account/backend/auth/customer-request-origins.service";
import { CustomerAccountDeletionEndpoint } from "@/features/account/backend/auth/delete-account-endpoint";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "@/features/account/backend/customer-authentication.service";
import { CustomerAvatarService } from "@/features/account/backend/customer-avatar.service";
import { CustomerLocalePreference } from "@/features/account/backend/customer-locale-preference.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import { CustomerReservationHistoryService } from "@/features/account/backend/customer-reservation-history.service";
import type { CustomerProfile } from "@/features/account/contracts";
import {
  type CustomerAccountAccessError,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { ReservationInvoicePdfService } from "@/features/accounting/backend/reservation-invoice-pdf.service";
import { CheckoutService } from "@/features/checkout/backend/checkout";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { CheckoutStatusService } from "@/features/checkout/backend/checkout/checkout-status.service";
import { ReservationSupersessionService } from "@/features/checkout/backend/checkout/reservation-supersession.service";
import {
  featureFlagsByRequestCohort,
  releaseGateForRunOverFlags,
  testReleaseCohortHeader,
} from "@/features/feature-flags/backend/release-cohorts.test-utils";
import type { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { MarketingPreferences } from "@/features/legal/backend/marketing-preferences.service";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { ReviewAccountsMock } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import {
  makeMemoryRequestBudget,
  unavailableRequestBudget,
} from "@/shared/backend/request-budget/memory-request-budget.test-utils";
import { toWorkspaceWebHandler } from "@/shared/backend/workspace-effect";
import { continueMutationsAfterDisconnect } from "@/shared/backend/workspace-http-api-route";
import { makeMeetingPoint } from "@/shared/testing/overlapping-requests.test-utils";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import {
  CustomerAccountLayers,
  type CustomerAccountServiceLayers,
} from "./customer-account-layers";
import { makeWorkspaceCustomerApiLayer } from "./customer-api.server";
import {
  type CustomerBookingCatalogLayerSet,
  CustomerBookingCatalogLayers,
} from "./customer-booking-catalog-layers";
import {
  type CustomerBookingCheckoutLayerSet,
  CustomerBookingCheckoutLayers,
} from "./customer-booking-checkout-layers";
import { CustomerCheckoutOperations } from "./customer-checkout-operations.service";
import {
  CustomerReservationLayers,
  type CustomerReservationServiceLayers,
} from "./customer-reservation-layers";

/** The origin Better Auth trusts in a customer API test. */
export const trustedOrigin = "https://workspace.deskohub.test";

/** How the request's Better Auth session reads. */
export type TestSession =
  | CustomerAccountSession
  | null
  | { readonly failure: CustomerAccountAccessError };

/** A session read that can't answer. */
export const unavailableSession: TestSession = {
  failure: customerAccountUnavailable("authentication.session"),
};

export type CustomerApiTestOptions = {
  /** Defaults to `testCustomerSession` (account-operations.test-utils). */
  readonly session?: TestSession;
  /**
   * Better Auth's answer for an `Origin`; `"unavailable"` when it can't
   * answer. Defaults to trusting `trustedOrigin` only.
   */
  readonly isTrustedOrigin?: (origin: string) => boolean | "unavailable";
  /** A budget store that can't be checked. */
  readonly budgetUnavailable?: boolean;
  /**
   * Account service fakes. Every service left out is a `Layer.mock` with
   * nothing implemented, so an endpoint that uses it dies.
   */
  readonly services?: Partial<CustomerAccountServiceLayers>;
  /** Release gates; each left out is closed. */
  readonly releases?: Partial<AccountReleaseLayers>;
  /**
   * Booking catalog fakes, like `services`: each left out is a `Layer.mock`
   * with nothing implemented, and its release gates are closed.
   */
  readonly bookingCatalog?: Partial<CustomerBookingCatalogLayerSet>;
  /** Booking checkout fakes, like `bookingCatalog`. */
  readonly bookingCheckout?: Partial<CustomerBookingCheckoutLayerSet>;
  /**
   * Reservation service fakes, each left out a `Layer.mock` with nothing
   * implemented, like `services`.
   */
  readonly reservations?: Partial<CustomerReservationServiceLayers>;
};

/**
 * The customer API served over fakes, exactly as
 * `handleWorkspaceCustomerApiRequest` serves it: the real middleware,
 * handlers, error mapping and disconnect handling, with the session, origin
 * authority, request budget and account services faked. `sessionReads`
 * counts authoritative session reads, `budgetSpends` every budget spend.
 */
export const makeCustomerApiTestServer = (
  options: CustomerApiTestOptions = {}
) => {
  let sessionReads = 0;
  const budget = makeMemoryRequestBudget();
  const records = {
    get sessionReads() {
      return sessionReads;
    },
    get budgetSpends() {
      return budget.spends();
    },
  };
  const session =
    options.session === undefined ? testCustomerSession : options.session;
  const isTrustedOrigin =
    options.isTrustedOrigin ?? ((origin: string) => origin === trustedOrigin);

  const fakes = Layer.mergeAll(
    Layer.succeed(CustomerAuthentication, {
      currentUser: Effect.suspend(() => {
        sessionReads += 1;
        return session !== null && "failure" in session
          ? Effect.fail(session.failure)
          : Effect.succeed(session);
      }),
    }),
    CustomerRequestOrigins.fromAuthority({
      isTrustedOrigin: async (origin) => {
        const answer = isTrustedOrigin(origin);
        if (answer === "unavailable") {
          throw new Error("Better Auth context unavailable");
        }
        return answer;
      },
    }),
    options.budgetUnavailable
      ? unavailableRequestBudget("budget store down")
      : budget.layer,
    Layer.succeed(CustomerAccountLayers, {
      services: { ...unusedAccountServices, ...options.services },
      releases: { ...closedReleases, ...options.releases },
    }),
    Layer.succeed(CustomerBookingCatalogLayers, {
      ...unusedBookingCatalog,
      ...options.bookingCatalog,
    }),
    Layer.succeed(CustomerBookingCheckoutLayers, {
      ...unusedBookingCheckout,
      ...options.bookingCheckout,
    }),
    Layer.succeed(CustomerReservationLayers, {
      ...unusedReservationServices,
      ...options.reservations,
    })
  );

  const handle = continueMutationsAfterDisconnect(
    toWorkspaceWebHandler(
      makeWorkspaceCustomerApiLayer().pipe(Layer.provide(fakes))
    )
  );

  return { handle, records };
};

const unusedAccountServices: CustomerAccountServiceLayers = {
  currentAccount: Layer.mock(CurrentCustomerAccount, {}),
  resolver: Layer.mock(CustomerAccountResolver, {}),
  profile: Layer.mock(CustomerProfileService, {}),
  avatar: Layer.mock(CustomerAvatarService, {}),
  passkeys: Layer.mock(CustomerPasskeys, {}),
  assistants: Layer.mock(CustomerAgentConnections, {}),
  reviewAccounts: ReviewAccountsMock({}),
  referrals: ReferralServiceMock({}),
  signupIntents: Layer.mock(ReferralSignupIntentRepository, {}),
  contacts: Layer.mock(CustomerAccountContactService, {}),
  marketingPreferences: Layer.mock(MarketingPreferences, {}),
  consentLedger: Layer.mock(MarketingConsentLedger, {}),
  accountDeletion: Layer.mock(CustomerAccountDeletionEndpoint, {}),
  analyticsConsentLedger: Layer.mock(AnalyticsConsentLedger, {}),
  analyticsPersonAnonymisation: Layer.mock(AnalyticsPersonAnonymisation, {}),
  localePreference: Layer.mock(CustomerLocalePreference, {}),
};

const unusedReservationServices: CustomerReservationServiceLayers = {
  contacts: () => Layer.mock(CustomerAccountContactService, {}),
  history: Layer.mock(CustomerReservationHistoryService, {}),
  authorization: () => Layer.mock(ReservationAuthorizationService, {}),
  checkoutStatus: Layer.mock(CheckoutStatusService, {}),
  access: () => Layer.mock(ReservationAccessService, {}),
  invoice: () => Layer.mock(ReservationInvoicePdfService, {}),
};

/** The Dotypos profile of `linkedAccountServices`' account. */
export const testCustomerProfile: CustomerProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  billing: null,
};

/**
 * Account services for the session's account, linked to its Dotypos
 * customer with `testCustomerProfile`, no avatar, passkeys or assistants,
 * and no referral. Spread overrides over it.
 */
export const linkedAccountServices: CustomerAccountServiceLayers = {
  ...unusedAccountServices,
  // The request's session, linked to `testLinkedAccount`'s customer unless
  // it is signed out or awaiting deletion.
  currentAccount: Layer.effect(
    CurrentCustomerAccount,
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      return CurrentCustomerAccount.of({
        resolve: authentication.currentUser.pipe(
          Effect.map((session) => {
            if (session === null) return { kind: "signed-out" } as const;
            if (session.deletionRequested) {
              return {
                kind: "deletion-pending",
                session,
                reviewMarker: "absent",
              } as const;
            }
            return {
              kind: "linked",
              session,
              reviewMarker: "absent",
              account: testLinkedAccount,
              autoLinked: false,
            } as const;
          })
        ),
        peek: Effect.die("peek is not faked"),
        requireActive: Effect.die("requireActive is not faked"),
      });
    })
  ),
  resolver: Layer.mock(CustomerAccountResolver, {
    resolve: Effect.succeed(testLinkedAccount),
  }),
  profile: Layer.mock(CustomerProfileService, {
    load: () => Effect.succeed(testCustomerProfile),
    update: () => Effect.succeed(testCustomerProfile),
  }),
  avatar: Layer.mock(CustomerAvatarService, {
    lookup: () => Effect.succeed(null),
  }),
  passkeys: Layer.mock(CustomerPasskeys, { list: Effect.succeed([]) }),
  assistants: Layer.mock(CustomerAgentConnections, {
    list: Effect.succeed([]),
  }),
  reviewAccounts: ReviewAccountsMock({
    isReviewAccount: () => Effect.succeed(false),
  }),
  referrals: ReferralServiceMock({
    hasSettledReferral: () => Effect.succeed(false),
  }),
  signupIntents: Layer.mock(ReferralSignupIntentRepository, {
    find: () => Effect.succeed(undefined),
  }),
};

const unusedBookingCatalog: CustomerBookingCatalogLayerSet = {
  pricing: Layer.mock(CheckoutPricingService, {}),
  inventory: Layer.mock(AdvisoryAvailabilityInventory, {}),
  availability: Layer.mergeAll(
    Layer.mock(WorkspaceAvailabilityService, {}),
    Layer.mock(ReservationSupersessionService, {}),
    TestSealedStateKeys
  ),
  sealedStateKeys: TestSealedStateKeys,
  releases: {
    office: OfficeReleaseGate.fromDecision(false),
    referral: ReferralReleaseGate.fromDecision(false),
  },
};

const unusedBookingCheckout: CustomerBookingCheckoutLayerSet = {
  operations: Layer.mock(CustomerCheckoutOperations, {}),
  checkout: Layer.mock(CheckoutService, {}),
  inventory: Layer.mock(AdvisoryAvailabilityInventory, {}),
  releases: {
    office: OfficeReleaseGate.fromDecision(false),
    referral: ReferralReleaseGate.fromDecision(false),
  },
};

const closedReleases: AccountReleaseLayers = {
  referralRelease: ReferralReleaseGate.fromDecision(false),
  passkeyRelease: PasskeyReleaseGate.fromDecision(false),
  avatarRelease: AccountAvatarReleaseGate.fromDecision(false),
};

/**
 * The account release gates, each decided once per build over
 * `featureFlags`, as `runAccountReleaseLayers` decides them over PostHog.
 */
export const accountReleasesOver = (
  featureFlags: Layer.Layer<WorkspaceFeatureFlagService>
): AccountReleaseLayers => ({
  referralRelease: releaseGateForRunOverFlags(
    ReferralReleaseGate,
    featureFlags
  ),
  passkeyRelease: releaseGateForRunOverFlags(PasskeyReleaseGate, featureFlags),
  avatarRelease: releaseGateForRunOverFlags(
    AccountAvatarReleaseGate,
    featureFlags
  ),
});

/** The release cohorts a request can be in: every flag on, or every flag off. */
const releaseCohorts = ["open", "closed"] as const;
type ReleaseCohort = (typeof releaseCohorts)[number];

/** The call in `cohort`'s release cohort. */
export const inReleaseCohort = (
  call: CustomerApiCall,
  cohort: ReleaseCohort
): CustomerApiCall => ({
  ...call,
  headers: { ...call.headers, [testReleaseCohortHeader]: cohort },
});

/** The status and JSON body of a response; `null` for an empty body. */
const statusAndBody = async (response: Response) => {
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
};

/** What `answerInEachReleaseCohort` found. */
type CohortAnswers<A> = {
  readonly alone: Readonly<Record<ReleaseCohort, A>>;
  readonly overlapping: Readonly<Record<ReleaseCohort, A>>;
  /** Per flag evaluation, how many overlapping requests made it. */
  readonly arrivals: Readonly<Record<string, number>>;
};

/**
 * Answers the request `send` makes for each release cohort twice: alone, on
 * its own server, and overlapping the other cohort's request on one server,
 * where each request evaluates every flag while the other evaluates it too.
 * `serve` makes a server whose release gates are decided over the feature
 * flags it's given, which decide by each request's own cohort. `answer`
 * reads what a test compares from a response, by default its status and
 * JSON body.
 */
export const answerInEachReleaseCohort = async <A = unknown>({
  serve,
  send,
  answer = statusAndBody as (response: Response) => Promise<A>,
}: {
  readonly serve: (featureFlags: Layer.Layer<WorkspaceFeatureFlagService>) => {
    readonly handle: (request: Request) => Promise<Response>;
  };
  readonly send: (cohort: ReleaseCohort) => Request;
  readonly answer?: (response: Response) => Promise<A>;
}): Promise<CohortAnswers<A>> => {
  const alone: Partial<Record<ReleaseCohort, A>> = {};
  for (const cohort of releaseCohorts) {
    const server = serve(featureFlagsByRequestCohort(makeMeetingPoint(1)));
    alone[cohort] = await answer(await server.handle(send(cohort)));
  }
  const meetingPoint = makeMeetingPoint(releaseCohorts.length);
  const server = serve(featureFlagsByRequestCohort(meetingPoint));
  const overlapping = Object.fromEntries(
    await Promise.all(
      releaseCohorts.map(async (cohort) => [
        cohort,
        await answer(await server.handle(send(cohort))),
      ])
    )
  ) as Record<ReleaseCohort, A>;
  return {
    alone: alone as Record<ReleaseCohort, A>,
    overlapping,
    arrivals: meetingPoint.arrivals(),
  };
};

/**
 * Checks what `answerInEachReleaseCohort` found: the cohorts answer
 * differently alone, each overlapping request answers as its cohort does
 * alone, and both requests evaluated every flag either evaluated.
 */
export const expectEachCohortAnsweredAlone = <A>({
  alone,
  overlapping,
  arrivals,
}: CohortAnswers<A>) => {
  expect(alone.open).not.toEqual(alone.closed);
  expect(overlapping).toEqual(alone);
  expect(Object.keys(arrivals).length).toBeGreaterThan(0);
  for (const evaluations of Object.values(arrivals)) {
    expect(evaluations).toBe(releaseCohorts.length);
  }
};

/** A customer API endpoint call, as a test sends it. */
export type CustomerApiCall = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The path below `/api/customer`, such as `/account/profile`. */
  readonly path: string;
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Extra headers; `undefined` removes one, such as the client header. */
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
};

/**
 * The request a first-party client sends: with the customer API client
 * header, and a JSON body when the call has one.
 */
export const customerApiRequest = (call: CustomerApiCall) => {
  const headers = new Headers({
    [customerApiClientHeader.name]: customerApiClientHeader.value,
  });
  if (call.body !== undefined) headers.set("content-type", "application/json");
  for (const [name, value] of Object.entries(call.headers ?? {})) {
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request(
    `https://workspace.deskohub.test${customerApiPathPrefix}${call.path}`,
    {
      method: call.method,
      headers,
      ...(call.body !== undefined && { body: JSON.stringify(call.body) }),
      ...(call.signal && { signal: call.signal }),
    }
  );
};

/** Headers a browser sends on a cross-site request. */
const crossSiteHeaders = {
  "sec-fetch-site": "cross-site",
  origin: "https://attacker.example",
} as const;

/** The call without the customer API client header. */
export const withoutClientHeader = (
  call: CustomerApiCall
): CustomerApiCall => ({
  ...call,
  headers: { ...call.headers, [customerApiClientHeader.name]: undefined },
});

/** The call as a cross-site browser page would send it. */
const fromCrossSite = (call: CustomerApiCall): CustomerApiCall => ({
  ...call,
  headers: { ...call.headers, ...crossSiteHeaders },
});

/**
 * Registers the two guard tests every endpoint has: a signed-out caller
 * gets 401, and a cross-site request gets 403 before any session lookup.
 * Call it inside the endpoint's `describe` with a valid call.
 */
export const testCustomerEndpointGuards = (call: CustomerApiCall) => {
  test("asks a signed-out caller to sign in", async () => {
    const api = makeCustomerApiTestServer({ session: null });

    const response = await api.handle(customerApiRequest(call));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ _tag: "CustomerSessionRequired" });
  });

  test("refuses a cross-site request before any session lookup", async () => {
    const api = makeCustomerApiTestServer();

    const response = await api.handle(customerApiRequest(fromCrossSite(call)));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ _tag: "CustomerRequestRejected" });
    expect(api.records.sessionReads).toBe(0);
  });
};
