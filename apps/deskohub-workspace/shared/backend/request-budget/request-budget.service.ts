import { and, count, eq, lte, min } from "drizzle-orm";
import {
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
} from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { requestBudgetSpends as spends } from "@/db/schema";
import { WorkspaceLocks } from "@/db/workspace-locks";
import { currentInstant } from "@/shared/utils/temporal";

/**
 * A budget of `limit` requests per rolling `window`, shared by every caller
 * and server instance that spends under the same `key`.
 */
export interface RequestBudgetPolicy {
  readonly key: string;
  readonly limit: number;
  readonly window: Duration.Duration;
}

/**
 * `Exhausted.retryAt` is when the oldest spend leaves the window, the
 * earliest instant a new spend can be granted.
 */
export type RequestBudgetSpend = Data.TaggedEnum<{
  Granted: Record<never, never>;
  Exhausted: { readonly retryAt: DateTime.Utc };
}>;

export const RequestBudgetSpend = Data.taggedEnum<RequestBudgetSpend>();

export class RequestBudgetUnavailable extends Data.TaggedError(
  "RequestBudgetUnavailable"
)<{
  readonly key: string;
  readonly cause: unknown;
}> {}

interface IRequestBudget {
  /**
   * Spends one request from the policy's budget when the rolling window has
   * room. Concurrent spends under one key, from any instance, never exceed
   * the limit.
   */
  readonly spend: (
    policy: RequestBudgetPolicy
  ) => Effect.Effect<RequestBudgetSpend, RequestBudgetUnavailable>;
}

export class RequestBudget extends Context.Service<
  RequestBudget,
  IRequestBudget
>()("@deskohub-workspace/request-budget/RequestBudget") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { transaction } = yield* WorkspaceDatabase;

      const spend = Effect.fn("RequestBudget.spend")(
        (policy: RequestBudgetPolicy) =>
          currentInstant.pipe(
            Effect.flatMap((now) => transaction(spendBudget(policy, now))),
            Effect.mapError(
              (cause) =>
                new RequestBudgetUnavailable({ key: policy.key, cause })
            )
          )
      );

      return RequestBudget.of({ spend });
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

/**
 * Spends one request under a transaction-scoped lock on the policy's key,
 * then prunes, counts and records in the same transaction.
 */
const spendBudget = Effect.fn("RequestBudget.spendBudget")(function* (
  policy: RequestBudgetPolicy,
  now: Temporal.Instant
) {
  const { db } = yield* WorkspaceTransaction;
  yield* WorkspaceLocks.requestBudget(policy.key);

  // A spend at or before the window's start has left the window.
  const windowStart = now.subtract({
    milliseconds: Duration.toMillis(policy.window),
  });
  yield* db
    .delete(spends)
    .where(
      and(eq(spends.budgetKey, policy.key), lte(spends.spentAt, windowStart))
    );

  const [usage = { spent: 0, oldestSpentAt: null }] = yield* db
    .select({ spent: count(), oldestSpentAt: min(spends.spentAt) })
    .from(spends)
    .where(eq(spends.budgetKey, policy.key));

  return yield* Option.match(exhaustedUntil({ policy, usage, now }), {
    onNone: () =>
      db
        .insert(spends)
        .values({ budgetKey: policy.key, spentAt: now })
        .pipe(Effect.as<RequestBudgetSpend>(RequestBudgetSpend.Granted())),
    onSome: (retryAt) =>
      Effect.succeed<RequestBudgetSpend>(
        RequestBudgetSpend.Exhausted({ retryAt })
      ),
  });
});

interface BudgetUsage {
  readonly spent: number;
  readonly oldestSpentAt: Temporal.Instant | null;
}

/** When the window is full, the instant its oldest spend leaves it. */
const exhaustedUntil = ({
  policy,
  usage,
  now,
}: {
  readonly policy: RequestBudgetPolicy;
  readonly usage: BudgetUsage;
  readonly now: Temporal.Instant;
}): Option.Option<DateTime.Utc> =>
  Option.liftPredicate(usage, ({ spent }) => spent >= policy.limit).pipe(
    Option.map(({ oldestSpentAt }) =>
      DateTime.makeUnsafe(
        (oldestSpentAt ?? now).add({
          milliseconds: Duration.toMillis(policy.window),
        }).epochMilliseconds
      )
    )
  );
