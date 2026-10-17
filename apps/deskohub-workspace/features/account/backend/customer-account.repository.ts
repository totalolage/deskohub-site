import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
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

/**
 * Leaves the deleted account's tombstone, creating the record when the account
 * never had one. A repeated deletion keeps the first deletion instant.
 */
export const tombstoneCustomerAccount = (
  executor: WorkspaceDatabaseClient,
  accountId: CustomerAccountId,
  deletedAt: Temporal.Instant
) =>
  executor
    .insert(customerAccounts)
    .values({ id: accountId, deletedAt })
    .onConflictDoUpdate({
      target: customerAccounts.id,
      set: {
        deletedAt: sql`coalesce(${customerAccounts.deletedAt}, excluded.deleted_at)`,
      },
    })
    .pipe(Effect.asVoid);
