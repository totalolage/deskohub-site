import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { customerAccounts } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { CustomerAccountId } from "../customer-account";

/**
 * Whether the account's login is gone. A login-less account has no
 * `customer_account_links` row either, because those cascade from the login.
 */
export const accountLoginMissing = (db: WorkspaceDatabaseClient) =>
  notExists(
    db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.id, customerAccounts.id))
  );

/**
 * Whether a live account without a login counts as orphaned at `now`: only
 * once it is a day old. A sign-up commits its account before Better Auth
 * inserts the login, so a younger one may still be signing up.
 */
export const accountSettled = (now: SQL = sql`now()`) =>
  lt(customerAccounts.createdAt, sql`${now} - interval '1 day'`);

/**
 * Marks the live accounts whose login is gone deleted and frees their
 * Dotypos customers, as an account deletion does. An account deletion
 * already does this before it deletes the login, so only an interrupted
 * sign-up or deletion leaves one behind. Limited to `accountIds` when given;
 * returns how many it marked.
 */
export const tombstoneOrphanedAccounts = Effect.fn(function* (
  db: WorkspaceDatabaseClient,
  input: {
    readonly now?: SQL;
    readonly accountIds?: readonly CustomerAccountId[];
  } = {}
) {
  if (input.accountIds?.length === 0) return 0;
  const rows = yield* db
    .update(customerAccounts)
    .set({ deletedAt: sql`now()`, dotyposCustomerId: null })
    .where(
      and(
        input.accountIds && inArray(customerAccounts.id, [...input.accountIds]),
        isNull(customerAccounts.deletedAt),
        accountLoginMissing(db),
        accountSettled(input.now)
      )
    )
    .returning({ id: customerAccounts.id });
  return rows.length;
});

/**
 * Creates the account's durable record when it has none, through the caller's
 * transaction executor, so the record commits with the row that names the
 * account. A deleted account's tombstone stays a tombstone.
 */
export const ensureCustomerAccount = (
  executor: WorkspaceDatabaseClient,
  accountId: CustomerAccountId
) =>
  executor
    .insert(customerAccounts)
    .values({ id: accountId })
    .onConflictDoNothing()
    .pipe(Effect.asVoid);

/**
 * Records the account's own Dotypos customer on its durable record, in the
 * transaction that writes the matching `customer_account_links` row. A
 * tombstone that still names the customer, because a deployment that predates
 * this column deleted its account, gives it up first, so the new link never
 * conflicts with a deleted account.
 */
export const recordCustomerAccountLink = Effect.fn(function* (
  executor: WorkspaceDatabaseClient,
  accountId: CustomerAccountId,
  customerId: DotyposCustomerId
) {
  yield* ensureCustomerAccount(executor, accountId);
  yield* executor
    .update(customerAccounts)
    .set({ dotyposCustomerId: null })
    .where(
      and(
        eq(customerAccounts.dotyposCustomerId, customerId),
        ne(customerAccounts.id, accountId),
        isNotNull(customerAccounts.deletedAt)
      )
    );
  yield* executor
    .update(customerAccounts)
    .set({ dotyposCustomerId: customerId })
    .where(eq(customerAccounts.id, accountId));
});

interface ICustomerAccountRepository {
  /**
   * Leaves the deleted account's tombstone, creating the record when the
   * account never had one, so the records it authored outlive the identity
   * that Better Auth removes next. A repeated deletion keeps the first
   * deletion instant. The tombstone gives up its Dotypos customer, as the
   * link row does when Better Auth removes the identity. Run it under the
   * account lock.
   */
  readonly tombstone: (
    accountId: CustomerAccountId,
    deletedAt: Temporal.Instant
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

/** The lifecycle of the durable Workspace customer account. */
export class CustomerAccountRepository extends Context.Service<
  CustomerAccountRepository,
  ICustomerAccountRepository
>()("@deskohub-workspace/account/CustomerAccountRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const tombstone = Effect.fn("CustomerAccountRepository.tombstone")(
        (accountId: CustomerAccountId, deletedAt: Temporal.Instant) =>
          db
            .insert(customerAccounts)
            .values({ id: accountId, deletedAt })
            .onConflictDoUpdate({
              target: customerAccounts.id,
              set: {
                deletedAt: sql`coalesce(${customerAccounts.deletedAt}, excluded.deleted_at)`,
                dotyposCustomerId: null,
              },
            })
            .pipe(Effect.asVoid)
      );

      return { tombstone } satisfies ICustomerAccountRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
