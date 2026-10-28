import { sql } from "drizzle-orm";
import { Context, Duration, Effect, Option, Order } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { RootDatabaseClient } from "./database-client";
import {
  type PostgresAdvisoryLockKey,
  postgresAdvisoryTransactionLockStatement,
  WorkspaceDatabaseAdvisoryLock,
} from "./postgres-advisory-lock";
import type { DatabaseQueryError } from "./sql-constraint";

/**
 * How a lock's key reaches Postgres. Each form keeps the SQL its lock used
 * before the registry, so old and new code lock the same key.
 */
type LockKey =
  /** `pg_advisory_xact_lock(hashtext(namespace), hashtext(key))` */
  | { readonly pair: PostgresAdvisoryLockKey }
  /** `pg_advisory_xact_lock($1::bigint)` */
  | { readonly bigint: bigint }
  /** `pg_advisory_xact_lock(hashtext(key))` */
  | { readonly hashed: string };

/** A registry lock: `name` appears in reports, never the key. */
type Lock = LockKey & { readonly name: string; readonly rank: number };

export type LockWait = {
  /**
   * Bounds the wait, in rank order or not: past it the lock fails with a lock
   * timeout instead of waiting on. Only a bounded wait may exceed the rank order.
   */
  readonly boundedWait?: Duration.Input;
};

export type TransactionLockRequest = Lock & {
  readonly wait?: LockWait | undefined;
};

type HeldLock = Lock & { readonly holder: "section" | "transaction" };

/**
 * Orders keys within a rank. Ranks hold one key form each; across forms the
 * order is arbitrary but total.
 */
const keyOrder: Order.Order<LockKey> = (self, that) => {
  if ("pair" in self && "pair" in that) {
    return (
      Order.String(self.pair[0], that.pair[0]) ||
      Order.String(self.pair[1], that.pair[1])
    );
  }
  if ("bigint" in self && "bigint" in that) {
    return Order.BigInt(self.bigint, that.bigint);
  }
  if ("hashed" in self && "hashed" in that) {
    return Order.String(self.hashed, that.hashed);
  }
  return Order.Number(formOrder(self), formOrder(that));
};

const formOrder = (key: LockKey) => {
  if ("pair" in key) return 0;
  return "bigint" in key ? 1 : 2;
};

/** Ascending rank, then ascending key: the order locks must be taken in. */
const lockOrder = Order.combine<Lock>(
  Order.mapInput(Order.Number, (lock: Lock) => lock.rank),
  keyOrder
);

const isSameKey = (self: LockKey, that: LockKey) => keyOrder(self, that) === 0;

/** Sections held by this fiber's enclosing `holdSection` calls; transactions read it. */
const HeldSections = Context.Reference<ReadonlyArray<HeldLock>>(
  "@deskohub-workspace/db/WorkspaceHeldLockSections",
  { defaultValue: () => [] }
);

type Savepoint = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) => Effect.Effect<A, E | DatabaseQueryError, R>;

type TransactionLedger = {
  /** Locks this transaction holds, savepoints included; replaced, never mutated. */
  held: ReadonlyArray<HeldLock>;
  /** The client that opened the transaction, which its marker also carries. */
  readonly db: RootDatabaseClient;
  /** The opening service's own `transaction`, over the full client. */
  readonly savepoint: Savepoint;
};

/** Present exactly where `WorkspaceTransaction` is: inside a Workspace transaction. */
const CurrentTransactionLedger = Context.Reference<
  Option.Option<TransactionLedger>
>("@deskohub-workspace/db/WorkspaceTransactionLockLedger", {
  defaultValue: () => Option.none(),
});

/**
 * Gives a transaction body its ledger. A root starts empty. A nested one
 * starts from its parent's locks and replaces them only when it succeeds,
 * because a rolled-back savepoint releases the locks taken in it.
 */
export const openLockLedger =
  ({
    nested,
    db,
    savepoint,
  }: {
    nested: boolean;
    db: RootDatabaseClient;
    savepoint: Savepoint;
  }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(CurrentTransactionLedger, (current) => {
      const parent = nested ? current : Option.none();
      const ledger: TransactionLedger = {
        held: Option.match(parent, {
          onNone: () => [],
          onSome: ({ held }) => held,
        }),
        db,
        savepoint,
      };
      return effect.pipe(
        Effect.provideService(CurrentTransactionLedger, Option.some(ledger)),
        Effect.tap(() =>
          Effect.sync(() => {
            if (Option.isSome(parent)) parent.value.held = ledger.held;
          })
        )
      );
    });

const lockStatement = (key: LockKey) => {
  if ("pair" in key) return postgresAdvisoryTransactionLockStatement(key.pair);
  if ("bigint" in key) {
    return sql`select pg_advisory_xact_lock(${key.bigint.toString()}::bigint)`;
  }
  return sql`select pg_advisory_xact_lock(hashtext(${key.hashed}))`;
};

/**
 * Whole milliseconds, rounded up. Zero would disable `lock_timeout`, so a
 * wait that is not positive and finite is a defect.
 */
const lockTimeoutMillis = (wait: Duration.Input) =>
  Option.match(Duration.fromInput(wait), {
    onNone: () => Option.none<number>(),
    onSome: (duration) => {
      const millis = Duration.toMillis(duration);
      return Duration.isFinite(duration) && millis > 0
        ? Option.some(Math.ceil(millis))
        : Option.none();
    },
  });

/**
 * Until enforcement lands, a lock-order violation fails under `bun test` and
 * is logged in production, where the lock is then taken as requested.
 */
const reportViolation = (
  message: string,
  code: "workspace-lock-order" | "workspace-lock-section-in-transaction",
  requested: { readonly name: string; readonly rank: number },
  heldAbove: ReadonlyArray<HeldLock>
) => {
  // Names and ranks only: key values can identify a customer.
  const held = heldAbove.map(({ name }) => name);
  return process.env.NODE_ENV === "test"
    ? Effect.die(
        new Error(`${message}: ${requested.name} after ${held.join(", ")}`)
      )
    : Effect.logError(message).pipe(
        Effect.annotateLogs({
          code,
          requested: requested.name,
          rank: requested.rank,
          heldAbove: held,
        })
      );
};

/**
 * Takes a transaction-scoped advisory lock in the open Workspace transaction
 * and records it in the transaction's ledger.
 */
export const takeTransactionLock = ({
  wait,
  ...lock
}: TransactionLockRequest): Effect.Effect<void, DatabaseQueryError> =>
  Effect.gen(function* () {
    const boundedWait = wait?.boundedWait;
    const timeoutMillis =
      boundedWait === undefined
        ? Option.none<number>()
        : yield* Option.match(lockTimeoutMillis(boundedWait), {
            onNone: () =>
              Effect.die(
                new Error(
                  "A bounded lock wait must be a positive, finite duration"
                )
              ),
            onSome: (millis) => Effect.succeed(Option.some(millis)),
          });
    const sections = yield* HeldSections;
    const current = yield* CurrentTransactionLedger;
    if (Option.isNone(current)) {
      return yield* Effect.die(
        new Error("A Workspace lock was taken outside a Workspace transaction")
      );
    }
    const ledger = current.value;
    const { db } = ledger;
    // The section holds the key on another connection, so this would wait
    // on itself until a statement timeout.
    if (sections.some((held) => isSameKey(held, lock))) {
      return yield* Effect.die(
        new Error(
          `The Workspace lock ${lock.name} is held by an enclosing lock section; taking it in the transaction would wait on that section`
        )
      );
    }
    const statement = lockStatement(lock);
    // Postgres keeps one hold however often it is taken; executing again is
    // still correct where the ledger forgot a lock it holds.
    if (ledger.held.some((held) => isSameKey(held, lock))) {
      yield* db.execute(statement);
      return;
    }
    const heldAbove = [...sections, ...ledger.held].filter((held) =>
      Order.isGreaterThan(lockOrder)(held, lock)
    );
    const allowedOutOfOrder =
      Option.isSome(timeoutMillis) &&
      heldAbove.every(({ holder }) => holder === "section");
    if (heldAbove.length > 0 && !allowedOutOfOrder) {
      yield* reportViolation(
        "A Workspace lock was taken out of rank order",
        "workspace-lock-order",
        lock,
        heldAbove
      );
    }
    // A given bounded wait always bounds the wait, in rank order or not.
    if (Option.isSome(timeoutMillis)) {
      yield* ledger.savepoint(
        withLockTimeout(db, timeoutMillis.value, db.execute(statement))
      );
    } else {
      yield* db.execute(statement);
    }
    ledger.held = [...ledger.held, { ...lock, holder: "transaction" }];
  });

/**
 * Runs `effect` with `lock_timeout` set for the current transaction, then
 * restores the previous value. Run it in a savepoint: a timeout rolls the
 * savepoint back, which also restores the setting.
 */
const withLockTimeout = <A, E, R>(
  db: RootDatabaseClient,
  millis: number,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    // Effect SQL's own client, which types its rows; Drizzle's `execute`
    // types a raw result as rows. Both join the open transaction.
    const client = db.$client;
    const [setting] = yield* client<{
      readonly timeout: string;
    }>`select current_setting('lock_timeout') as timeout`;
    yield* client`select set_config('lock_timeout', ${`${millis}ms`}, true)`;
    const result = yield* effect;
    yield* client`select set_config('lock_timeout', ${setting?.timeout ?? "0"}, true)`;
    return result;
  });

/**
 * Holds a session lock section: the lock on its own connection, through
 * `WorkspaceDatabaseAdvisoryLock.withLock`, while `effect` runs. Sections are
 * not reentrant, and a section entered inside a Workspace transaction waits
 * on that transaction's locks from another connection.
 */
export const holdSection =
  (section: {
    readonly name: string;
    readonly rank: number;
    readonly pair: PostgresAdvisoryLockKey;
  }) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<
    A,
    E | SqlError.SqlError,
    R | WorkspaceDatabaseAdvisoryLock
  > =>
    Effect.gen(function* () {
      const transaction = yield* CurrentTransactionLedger;
      if (Option.isSome(transaction)) {
        yield* reportViolation(
          "A Workspace lock section was entered inside a Workspace transaction",
          "workspace-lock-section-in-transaction",
          section,
          transaction.value.held
        );
      }
      const sections = yield* HeldSections;
      if (sections.some((held) => isSameKey(held, section))) {
        return yield* Effect.die(
          new Error(
            `The Workspace lock section ${section.name} was entered inside itself; sections are not reentrant`
          )
        );
      }
      const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;
      return yield* advisoryLock.withLock(
        section.pair,
        Effect.provideService(effect, HeldSections, [
          ...sections,
          { ...section, holder: "section" },
        ])
      );
    });
