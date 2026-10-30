import { and, eq, isNull, lt, notExists, type SQL, sql } from "drizzle-orm";
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
 * Marks the live accounts whose login is gone deleted and frees their
 * Dotypos customers, as an account deletion does, once they are a day old at
 * `now`. A sign-up commits its account before Better Auth inserts the login,
 * so a younger one may still be signing up, and an account deletion marks
 * the account before it deletes the login, so only an interrupted sign-up or
 * deletion leaves one behind. Returns how many it marked.
 */
export const tombstoneOrphanedAccounts = Effect.fn(function* (
  db: WorkspaceDatabaseClient,
  now: SQL
) {
  const rows = yield* db
    .update(customerAccounts)
    .set({ deletedAt: sql`now()`, dotyposCustomerId: null })
    .where(
      and(
        isNull(customerAccounts.deletedAt),
        lt(customerAccounts.createdAt, sql`${now} - interval '1 day'`),
        notExists(
          db
            .select({ id: authUser.id })
            .from(authUser)
            .where(eq(authUser.id, customerAccounts.id))
        )
      )
    )
    .returning({ id: customerAccounts.id });
  return rows.length;
});

/**
 * Creates the account's durable record when it has none. It is idempotent and
 * correct on its own, so it needs no transaction; inside one it joins it. A
 * deleted account's tombstone stays a tombstone.
 */
export const ensureCustomerAccount = (accountId: CustomerAccountId) =>
  Effect.flatMap(WorkspaceDatabase, ({ db }) =>
    db
      .insert(customerAccounts)
      .values({ id: accountId })
      .onConflictDoNothing()
      .pipe(Effect.asVoid)
  );

interface ICustomerAccountRepository {
  /**
   * Leaves the deleted account's tombstone, creating the record when the
   * account never had one, so the records it authored outlive the identity
   * that Better Auth removes next. A repeated deletion keeps the first
   * deletion instant. The tombstone gives up its Dotypos customer, so another
   * account can claim it. Run it under the account lock.
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
