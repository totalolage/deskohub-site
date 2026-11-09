import type { Pool } from "pg";
import type { PostgresAdvisoryLockKey } from "@/db/postgres-advisory-lock";

type LockQueryPool = Pick<Pool, "query">;

/**
 * Runs `sql` in a transaction left open on its own connection, so the locks
 * it takes stay held until `commit`. `pid` identifies the holder for
 * `pg_blocking_pids`.
 */
export const holdPostgresTransaction = async (
  pool: Pick<Pool, "connect">,
  sql: string,
  values: readonly unknown[]
) => {
  const client = await pool.connect();
  const {
    rows: [{ pid }],
  } = await client.query("select pg_backend_pid() as pid");
  await client.query("begin");
  const { rows } = await client.query(sql, [...values]);
  return {
    pid: pid as number,
    rows,
    commit: async () => {
      await client.query("commit");
      client.release();
    },
  };
};

/**
 * Resolves once a Postgres backend is blocked on a lock matching `condition`
 * (a `pg_locks` predicate, with `$n` placeholders bound to `values`), so
 * concurrency tests prove a waiter exists instead of sleeping.
 */
export const waitForPostgresLockWaiter = async (
  pool: LockQueryPool,
  waiter: {
    readonly condition: string;
    readonly values?: readonly unknown[];
    readonly description: string;
  }
) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(
      `select 1 from pg_locks where not granted and ${waiter.condition}`,
      waiter.values === undefined ? undefined : [...waiter.values]
    );
    if (waiting.rows.length > 0) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${waiter.description}.`);
};

/**
 * Resolves once a backend waits on the advisory lock taken by
 * `pg_advisory_xact_lock(hashtext(key[0]), hashtext(key[1]))`, the scheme
 * behind `withPostgresAdvisoryLock`. The two-int4 form stores each `hashtext`
 * as an unsigned 32-bit id with `objsubid` 2.
 */
export const waitForAdvisoryLockWaiter = (
  pool: LockQueryPool,
  key: PostgresAdvisoryLockKey
) =>
  waitForPostgresLockWaiter(pool, {
    condition: `
      locktype = 'advisory'
      and classid::bigint = (hashtext($1)::bigint & 4294967295)
      and objid::bigint = (hashtext($2)::bigint & 4294967295)
      and objsubid = 2
    `,
    values: key,
    description: `the ${key[0]} advisory lock waiter`,
  });
