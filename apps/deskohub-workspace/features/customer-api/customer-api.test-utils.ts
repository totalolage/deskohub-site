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
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import { CustomerRequestOrigins } from "@/features/account/backend/auth/customer-request-origins.service";
import { CustomerAccountDeletionEndpoint } from "@/features/account/backend/auth/delete-account-endpoint";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "@/features/account/backend/customer-authentication.service";
import { CustomerAvatarService } from "@/features/account/backend/customer-avatar.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import { CustomerReservationHistoryService } from "@/features/account/backend/customer-reservation-history.service";
import type { CustomerProfile } from "@/features/account/contracts";
import {
  type CustomerAccountAccessError,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { ReservationInvoicePdfService } from "@/features/accounting/backend/reservation-invoice-pdf.service";
import { CheckoutStatusService } from "@/features/checkout/backend/checkout/checkout-status.service";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { MarketingPreferences } from "@/features/legal/backend/marketing-preferences.service";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { ReservationAccessService } from "@/features/reservation/backend/reservation-access.service";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { ReviewAccountsMock } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import {
  makeMemoryRequestBudget,
  unavailableRequestBudget,
} from "@/shared/backend/request-budget/memory-request-budget.test-utils";
import { toWorkspaceWebHandler } from "@/shared/backend/workspace-effect";
import { continueMutationsAfterDisconnect } from "@/shared/backend/workspace-http-api-route";
import {
  CustomerAccountLayers,
  type CustomerAccountServiceLayers,
} from "./customer-account-layers";
import { makeWorkspaceCustomerApiLayer } from "./customer-api.server";
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
  resolver: Layer.mock(CustomerAccountResolver, {
    resolve: Effect.succeed(testLinkedAccount),
    resolveLink: Effect.succeed({
      account: testLinkedAccount,
      autoLinked: false,
    }),
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

const closedReleases: AccountReleaseLayers = {
  referralRelease: ReferralReleaseGate.fromDecision(false),
  passkeyRelease: PasskeyReleaseGate.fromDecision(false),
  avatarRelease: AccountAvatarReleaseGate.fromDecision(false),
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
