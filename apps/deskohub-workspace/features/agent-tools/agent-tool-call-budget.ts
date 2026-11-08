import "server-only";

import { Duration, Effect, Match } from "effect";
import type { CustomerAgentGrant } from "@/features/account";
import {
  RequestBudget,
  type RequestBudgetPolicy,
} from "@/shared/backend/request-budget/request-budget.service";
import { budgetKeyDigest } from "@/shared/backend/request-budget/request-budget-key";
import { AgentToolError } from "./agent-tool-error";

/**
 * A tighter per-account budget a signed-in tool spends on top of the
 * general signed-in budgets, such as a tool that calls Dotypos live.
 */
export interface AgentToolAccountBudget {
  readonly limit: number;
  readonly window: Duration.Duration;
}

/**
 * Calls one agent client may make for one account: a burst bound for a
 * runaway or looping assistant. Listing reservations, checking a status,
 * and starting a booking take a handful of calls.
 */
const grantCallBudget = { limit: 10, window: Duration.minutes(10) };

/**
 * Signed-in calls all of an account's agents may make together. Signed-in
 * tools read live Dotypos data, one to three requests per call, and the
 * whole site shares 150 Dotypos requests per 30 minutes, so one account's
 * agents can take at most two fifths of that window.
 */
const accountCallBudget = { limit: 20, window: Duration.minutes(30) };

/**
 * Spends the per-grant, per-account, and the tool's own account budgets of
 * one signed-in call. The per-IP limit stays the firewall rule every call
 * passes first. An exhausted budget refuses the call as rate limited; a
 * budget that can't be checked fails closed.
 */
export const spendSignedInCallBudgets = Effect.fn(
  "agentTools.spendSignedInCallBudgets"
)(function* ({
  grant,
  tool,
}: {
  readonly grant: CustomerAgentGrant;
  readonly tool: {
    readonly name: string;
    readonly accountBudget?: AgentToolAccountBudget;
  };
}) {
  const account = digest("account", grant.accountId);
  const policies: RequestBudgetPolicy[] = [
    {
      key: `agent-tool:grant:${digest("grant", grant.accountId, grant.clientId)}`,
      ...grantCallBudget,
    },
    { key: `agent-tool:account:${account}`, ...accountCallBudget },
    ...(tool.accountBudget
      ? [
          {
            key: `agent-tool:${tool.name}:account:${account}`,
            ...tool.accountBudget,
          },
        ]
      : []),
  ];
  const budget = yield* RequestBudget;

  yield* Effect.forEach(policies, (policy) =>
    budget.spend(policy).pipe(
      Effect.mapError(AgentToolError.unavailableService),
      Effect.flatMap((spend) =>
        Match.value(spend).pipe(
          Match.tagsExhaustive({
            Granted: () => Effect.void,
            Exhausted: () => Effect.fail(AgentToolError.rateLimited()),
          })
        )
      )
    )
  );
});

const digest = (...parts: ReadonlyArray<string>) =>
  budgetKeyDigest("deskohub-workspace/agent-tool-budget", ...parts);
