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
 * `dotypos-read` and `dotypos-mutation` may call Dotypos, whose allowance the
 * whole site shares, and spend that kind's Dotypos budget.
 */
export type CustomerRequestBudgetClass =
  | "workspace-only"
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
 * contract).
 */
export const customerRequestBudgetClasses = {
  account: {
    // The account's profile, and the lookup that links an unlinked account.
    getAccount: "dotypos-read",
    updateProfile: "dotypos-mutation",
    completeProfile: "dotypos-mutation",
    // Resolves the account's Dotypos customer the avatar belongs to.
    uploadAvatar: "dotypos-mutation",
    removeAvatar: "dotypos-mutation",
    // Better Auth's own tables.
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
  },
  reservations: {
    // Reservation details are read live from Dotypos; the status refresh
    // and the door code also call the payment and lock providers.
    listReservations: "dotypos-read",
    getReservationStatus: "dotypos-read",
    getReservationAccess: "dotypos-read",
    // Authorizing the invoice can resolve the account's Dotypos customer.
    getReservationInvoice: "dotypos-read",
  },
  booking: {},
} as const satisfies CustomerApiEndpointClassification;

/**
 * Requests one account may make, whatever they cost: a bound for a runaway
 * or looping client. Opening the account and its sections takes about six
 * requests, so this leaves room for a busy session and stops a loop within
 * minutes.
 */
const generalBudget = { limit: 60, window: Duration.minutes(10) };

/**
 * Dotypos-backed requests one account may make, reads and mutations apart so
 * an app that reloads its account screens can't spend the allowance its edits
 * and its deletion need. Opening the app reads up to three Dotypos-backed
 * endpoints; editing the profile or the avatar, saving consent and deleting
 * the account are mutations.
 *
 * The whole site shares 150 Dotypos requests per 30 minutes. A linked
 * account's request costs one or two Dotypos requests; resolving an unlinked
 * account and retrying a version conflict can reach four. An account that
 * spends both budgets makes about 52 Dotypos requests (20 reads and 6
 * mutations at two each), a third of the allowance, and at most 104. These
 * per-account budgets bound what one account, such as a looping client, can
 * take; they can't keep the site within the shared allowance, since enough
 * accounts each within their budgets still exceed it. The site, assistant
 * tools (`agentTools.spendSignedInCallBudgets`) and other accounts share the
 * rest.
 */
const dotyposReadBudget = { limit: 20, window: Duration.minutes(30) };
const dotyposMutationBudget = { limit: 6, window: Duration.minutes(30) };

/**
 * Spends the account's general budget, then its Dotypos read or mutation
 * budget when the endpoint is Dotypos-backed. An exhausted budget refuses
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
