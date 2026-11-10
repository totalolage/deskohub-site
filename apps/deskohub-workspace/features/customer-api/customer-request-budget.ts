import "server-only";

import {
  CustomerRateLimited,
  CustomerServiceUnavailable,
  type CustomerSession,
  type WorkspaceCustomerApi,
} from "@deskohub/workspace-customer-api";
import { Duration, Effect, Match } from "effect";
import type {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  RequestBudget,
  type RequestBudgetPolicy,
} from "@/shared/backend/request-budget/request-budget.service";
import { budgetKeyDigest } from "@/shared/backend/request-budget/request-budget-key";

/**
 * What an endpoint costs beyond its general request budget:
 * `workspace-only` reads only the Workspace database and Better Auth;
 * `catalog-read` reads the booking catalog's shared snapshots;
 * `account-read`, `dotypos-read` and `dotypos-mutation` may call Dotypos,
 * whose allowance the whole site shares, and spend that kind's budget.
 */
export type CustomerRequestBudgetClass =
  | "workspace-only"
  | "catalog-read"
  | "account-read"
  | "dotypos-read"
  | "dotypos-mutation";

type CustomerApiGroup =
  typeof WorkspaceCustomerApi extends HttpApi.HttpApi<infer _Id, infer Groups>
    ? Groups
    : never;

/** Every endpoint of every group, by group then endpoint name. */
export type CustomerApiEndpointClassification = {
  readonly [Group in CustomerApiGroup as HttpApiGroup.Name<Group>]: Record<
    HttpApiEndpoint.Name<HttpApiGroup.Endpoints<Group>>,
    CustomerRequestBudgetClass
  >;
};

/**
 * The budget class of every customer API endpoint. A new endpoint is a type
 * error here until it is classified. An endpoint is Dotypos-backed when it,
 * or the account resolution it starts with, can call Dotypos: resolving an
 * account that isn't linked yet looks its customer up, and may reactivate
 * an expired one. A Dotypos-backed GET is a read; every other method is a
 * mutation (`customer-request-budget.test.ts` checks it against the
 * contract). The account and reservation reads the app repeats, on every
 * load, every history visit and while a settling order's status polls, are
 * account reads; the account's other Dotypos-backed reads are Dotypos reads.
 * The booking catalog's reads are catalog reads: they read the shared
 * snapshots, which call Dotypos only when they miss, and a booking compares
 * several dates and prices before it checks out.
 */
export const customerRequestBudgetClasses = {
  account: {
    // The account's profile, and the lookup that links an unlinked account.
    getAccount: "account-read",
    updateProfile: "dotypos-mutation",
    completeProfile: "dotypos-mutation",
    // Resolves the account's Dotypos customer the avatar belongs to.
    uploadAvatar: "dotypos-mutation",
    removeAvatar: "dotypos-mutation",
    // Better Auth's own tables.
    updateLocale: "workspace-only",
    listPasskeys: "workspace-only",
    listAssistantConnections: "workspace-only",
    // Consent belongs to the account's Dotypos customer.
    getMarketingPreferences: "dotypos-read",
    saveMarketingPreferences: "dotypos-mutation",
    // Referral standing and savings follow the account's Dotypos customer.
    getReferrals: "dotypos-read",
    acknowledgeSignupReferral: "dotypos-mutation",
    // Deletion expires the Dotypos customer.
    requestDeletion: "dotypos-mutation",
    // The analytics consent ledger and Better Auth; a withdrawal's PostHog
    // person anonymisation runs after the response and never calls Dotypos.
    syncAnalyticsConsent: "workspace-only",
    getAnalyticsPreference: "workspace-only",
    saveAnalyticsPreference: "workspace-only",
  },
  reservations: {
    // Reservation details are read live from Dotypos; the status refresh
    // and the door code also call the payment and lock providers.
    listReservations: "account-read",
    getReservationStatus: "account-read",
    getReservationAccess: "account-read",
    // Authorizing the invoice can resolve the account's Dotypos customer.
    getReservationInvoice: "dotypos-read",
  },
  booking: {
    // The office's seat maximum reads the shared table snapshot, which
    // reads Dotypos when it misses.
    listOfferings: "catalog-read",
    // The shared table and reservation snapshots, read from Dotypos on a
    // miss.
    getAvailability: "catalog-read",
    getMeetingRoomStartTimes: "catalog-read",
    // An office quote checks the seats against the shared table snapshot.
    getQuote: "catalog-read",
    // The published documents' versions.
    listLegalDocuments: "workspace-only",
    // A booking spends two to four Dotypos mutations: the hold, an
    // optional code, the submission, and one retry after a price change.
    createCheckout: "dotypos-mutation",
    applyCheckoutDiscountCode: "dotypos-mutation",
    submitCheckout: "dotypos-mutation",
    // Reseals the signed checkout state only.
    acceptCheckoutPriceChange: "workspace-only",
  },
} as const satisfies CustomerApiEndpointClassification;

/**
 * Requests one account may make, whatever they cost: a bound for a runaway
 * or looping client. Opening the account and its sections takes about six
 * requests, and comparing dates and prices before a booking takes a few per
 * date, so this leaves room for a busy session, never binds before the
 * catalog budget, and stops a loop within minutes.
 */
const generalBudget = { limit: 120, window: Duration.minutes(10) };

/**
 * Booking catalog reads one account may make: offerings, availability,
 * meeting-room start times and quotes. One date costs about three, so this
 * covers comparing dozens of dates. They read the shared snapshots, which
 * call Dotypos only when they miss, so they leave the account read budget to
 * the account and its reservations.
 */
const catalogReadBudget = { limit: 120, window: Duration.minutes(10) };

/**
 * Dotypos-backed requests one account may make, in three budgets so that
 * neither the app's repeated reads nor its other sections can spend the
 * allowance its edits, its bookings and its deletion need.
 *
 * Account reads: the account, the reservation history, an order's status and
 * its door code. Opening the app costs two (the account and the history). A
 * booking costs up to thirteen: the account at the booking screen, the
 * order's status once and up to nine times more while the payment return
 * settles, then the history and the door code. Two bookings and a session's
 * navigation (about ten more account and history loads) come to about 38,
 * so 40 leaves no room for a third booking's polling; the app stops polling
 * on its own while fewer than eight reads are left by its own count.
 *
 * Dotypos reads: consent, referrals and the invoice, which the app reads
 * only when their screen or action opens.
 *
 * Mutations: editing the profile or the avatar, saving consent, deleting the
 * account and each checkout step that calls Dotypos. A booking spends up to
 * four (the hold, a rejected and an applied code, and the submission;
 * accepting a changed price spends none), so two bookings fit beside the
 * account's edits.
 *
 * The whole site shares 150 Dotypos requests per 30 minutes. A linked
 * account's request usually costs one or two Dotypos requests: an order's
 * status reads the reservation once, its door code reads the reservation and
 * the customer. It costs more when a read pages, when the account's
 * referral overview reads each invitee's reservations, when a call is
 * retried (up to three times), and when resolving an unlinked account or
 * retrying a version conflict. An account that spends all three budgets at
 * two Dotypos requests each makes about 150 (40 account reads, 20 Dotypos
 * reads and 15 mutations): with every budget spent, one account can take
 * the whole allowance, and more on the costlier paths. Catalog reads call
 * Dotypos only when a shared snapshot misses. These per-account budgets
 * bound what one account, such as a looping client, can take; they can't
 * keep the site within the shared allowance, since enough accounts each
 * within their budgets still exceed it. The site, assistant tools
 * (`agentTools.spendSignedInCallBudgets`) and other accounts share the
 * rest.
 */
const accountReadBudget = { limit: 40, window: Duration.minutes(30) };
const dotyposReadBudget = { limit: 20, window: Duration.minutes(30) };
const dotyposMutationBudget = { limit: 15, window: Duration.minutes(30) };

/**
 * Spends the account's general budget, then the budget of the endpoint's
 * class: its catalog, account read, Dotypos read or Dotypos mutation budget,
 * or none for a workspace-only endpoint. An exhausted budget refuses
 * the request as rate limited; a budget that can't be checked fails closed.
 * An endpoint the classification doesn't know spends the mutation budget,
 * though the type keeps that from happening.
 */
export const spendCustomerRequestBudgets = Effect.fn(
  "customerApi.spendCustomerRequestBudgets"
)(function* ({
  session,
  group,
  endpoint,
}: {
  readonly session: CustomerSession;
  readonly group: string;
  readonly endpoint: string;
}) {
  const account = digest("account", session.accountId);
  const policies: RequestBudgetPolicy[] = [
    { key: `customer-api:account:${account}`, ...generalBudget },
    ...Match.value(budgetClassOf(group, endpoint)).pipe(
      Match.withReturnType<RequestBudgetPolicy[]>(),
      Match.when("workspace-only", () => []),
      Match.when("catalog-read", () => [
        {
          key: `customer-api:catalog-read:account:${account}`,
          ...catalogReadBudget,
        },
      ]),
      Match.when("account-read", () => [
        {
          key: `customer-api:account-read:account:${account}`,
          ...accountReadBudget,
        },
      ]),
      Match.when("dotypos-read", () => [
        {
          key: `customer-api:dotypos-read:account:${account}`,
          ...dotyposReadBudget,
        },
      ]),
      Match.when("dotypos-mutation", () => [
        {
          key: `customer-api:dotypos-mutation:account:${account}`,
          ...dotyposMutationBudget,
        },
      ]),
      Match.exhaustive
    ),
  ];
  const budget = yield* RequestBudget;

  yield* Effect.forEach(policies, (policy) =>
    budget.spend(policy).pipe(
      Effect.tapError(() =>
        Effect.logWarning("Customer API request budget failed closed.")
      ),
      Effect.mapError(() => new CustomerServiceUnavailable()),
      Effect.flatMap((spend) =>
        Match.value(spend).pipe(
          Match.tagsExhaustive({
            Granted: () => Effect.void,
            Exhausted: () => Effect.fail(new CustomerRateLimited()),
          })
        )
      )
    )
  );
});

const budgetClassOf = (
  group: string,
  endpoint: string
): CustomerRequestBudgetClass =>
  (
    customerRequestBudgetClasses as Record<
      string,
      Record<string, CustomerRequestBudgetClass> | undefined
    >
  )[group]?.[endpoint] ?? "dotypos-mutation";

const digest = (...parts: ReadonlyArray<string>) =>
  budgetKeyDigest("deskohub-workspace/customer-api-budget", ...parts);
