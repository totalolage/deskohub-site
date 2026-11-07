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
 * What an endpoint costs beyond its general request budget: `general` reads
 * only the Workspace database and Better Auth; `dotypos` may call Dotypos,
 * whose allowance the whole site shares.
 */
export type CustomerRequestBudgetClass = "general" | "dotypos";

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
 * error here until it is classified. An endpoint is `dotypos` when it, or
 * the account resolution it starts with, can call Dotypos: resolving an
 * account that isn't linked yet looks its customer up, and may reactivate
 * an expired one.
 */
export const customerRequestBudgetClasses = {
  account: {
    // The account's profile, and the lookup that links an unlinked account.
    getAccount: "dotypos",
    updateProfile: "dotypos",
    completeProfile: "dotypos",
    // Resolves the account's Dotypos customer the avatar belongs to.
    uploadAvatar: "dotypos",
    removeAvatar: "dotypos",
    // Better Auth's own tables.
    listPasskeys: "general",
    listAssistantConnections: "general",
    // Consent belongs to the account's Dotypos customer.
    getMarketingPreferences: "dotypos",
    saveMarketingPreferences: "dotypos",
    // Referral standing and savings follow the account's Dotypos customer.
    getReferrals: "dotypos",
    acknowledgeSignupReferral: "dotypos",
    // Deletion expires the Dotypos customer.
    requestDeletion: "dotypos",
  },
  reservations: {},
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
 * Dotypos-backed requests one account may make. A linked account's request
 * costs one or two Dotypos requests; resolving an unlinked account and
 * retrying a version conflict can reach four. The whole site shares 150
 * Dotypos requests per 30 minutes, so 12 requests are about 24 Dotypos
 * requests (a sixth) for a linked account, and at most 48 (under a third),
 * leaving the site, assistant tools (`agentTools.spendSignedInCallBudgets`)
 * and other accounts the rest. A session that opens the account, edits the
 * profile and the avatar, and reloads after each, spends about six.
 */
const dotyposBudget = { limit: 12, window: Duration.minutes(30) };

/**
 * Spends the account's general budget, then its Dotypos budget when the
 * endpoint is Dotypos-backed. An exhausted budget refuses the request as
 * rate limited; a budget that can't be checked fails closed. An endpoint
 * the classification doesn't know spends both, though the type keeps that
 * from happening.
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
    ...(budgetClassOf(group, endpoint) === "dotypos"
      ? [{ key: `customer-api:dotypos:account:${account}`, ...dotyposBudget }]
      : []),
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
  )[group]?.[endpoint] ?? "dotypos";

const digest = (...parts: ReadonlyArray<string>) =>
  budgetKeyDigest("deskohub-workspace/customer-api-budget", ...parts);
