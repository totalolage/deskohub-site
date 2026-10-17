import { sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { customerAccounts } from "@/db/schema";
import type { CustomerAccountId } from "../customer-account";

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

interface ICustomerAccountRepository {
  /**
   * Leaves the deleted account's tombstone, creating the record when the
   * account never had one, so the records it authored outlive the identity
   * that Better Auth removes next. A repeated deletion keeps the first
   * deletion instant. Run it under the account lock.
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
              },
            })
            .pipe(Effect.asVoid)
      );

      return { tombstone } satisfies ICustomerAccountRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
