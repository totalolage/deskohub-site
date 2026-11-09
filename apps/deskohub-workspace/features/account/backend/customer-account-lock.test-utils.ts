import type { Pool } from "pg";
import { waitForAdvisoryLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";

/**
 * Resolves once a Postgres backend is blocked on the account advisory lock
 * for `account`, so lock tests prove a waiter exists instead of sleeping.
 * The key matches `withPostgresAdvisoryLock(["customer-account", account])`.
 */
export const waitForAccountAdvisoryLockWait = (
  pool: Pick<Pool, "query">,
  account: string
) => waitForAdvisoryLockWaiter(pool, ["customer-account", account]);
