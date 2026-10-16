import { and, count, eq, lte, min, sql } from "drizzle-orm";
import type {
  EffectPgQueryResultHKT,
  EffectPgTransaction,
} from "drizzle-orm/effect-postgres";
import {
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { relations } from "@/db/relations";
import { requestBudgetSpends as spends } from "@/db/schema";
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
      const { db } = yield* WorkspaceDatabase;

      const spend = Effect.fn("RequestBudget.spend")(
        (policy: RequestBudgetPolicy) =>
          currentInstant.pipe(
            Effect.flatMap((now) =>
              db.transaction((tx) => spendInTransaction({ tx, policy, now }))
            ),
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

type Transaction = EffectPgTransaction<
  EffectPgQueryResultHKT,
  typeof relations
>;

interface BudgetTransaction {
  readonly tx: Transaction;
  readonly policy: RequestBudgetPolicy;
}

/**
 * Serializes spends under one key with a transaction-scoped advisory lock,
 * then prunes, counts, and records within the same transaction.
 */
const spendInTransaction = (
  input: BudgetTransaction & { readonly now: Temporal.Instant }
) =>
  Effect.succeed(input).pipe(
    Effect.tap(lockBudget),
    Effect.let("windowStart", ({ now, policy }) =>
      now.subtract({ milliseconds: Duration.toMillis(policy.window) })
    ),
    Effect.tap(pruneExpiredSpends),
    Effect.bind("usage", readUsage),
    Effect.flatMap((state) =>
      Option.match(exhaustedUntil(state), {
        onNone: () =>
          recordSpend(state).pipe(
            Effect.as<RequestBudgetSpend>(RequestBudgetSpend.Granted())
          ),
        onSome: (retryAt) =>
          Effect.succeed<RequestBudgetSpend>(
            RequestBudgetSpend.Exhausted({ retryAt })
          ),
      })
    )
  );

const lockBudget = ({ tx, policy }: BudgetTransaction) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('request-budget'), hashtext(${policy.key}))`
  );

/** A spend at or before `windowStart` has left the window. */
const pruneExpiredSpends = ({
  tx,
  policy,
  windowStart,
}: BudgetTransaction & { readonly windowStart: Temporal.Instant }) =>
  tx
    .delete(spends)
    .where(
      and(eq(spends.budgetKey, policy.key), lte(spends.spentAt, windowStart))
    );

interface BudgetUsage {
  readonly spent: number;
  readonly oldestSpentAt: Temporal.Instant | null;
}

const readUsage = ({ tx, policy }: BudgetTransaction) =>
  tx
    .select({ spent: count(), oldestSpentAt: min(spends.spentAt) })
    .from(spends)
    .where(eq(spends.budgetKey, policy.key))
    .pipe(
      Effect.map(
        ([usage]): BudgetUsage => usage ?? { spent: 0, oldestSpentAt: null }
      )
    );

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

const recordSpend = ({
  tx,
  policy,
  now,
}: BudgetTransaction & { readonly now: Temporal.Instant }) =>
  tx.insert(spends).values({ budgetKey: policy.key, spentAt: now });
