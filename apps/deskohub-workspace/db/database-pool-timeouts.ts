import type { PoolConfig } from "pg";

export type DatabasePoolTimeouts = Pick<
  PoolConfig,
  "connectionTimeoutMillis" | "query_timeout" | "statement_timeout"
>;

const queryTimeoutMillis = 10_000;
const statementTimeoutMillis = 10_000;
const acquireConnectionHeadroomMillis = 5_000;

export const databasePoolTimeouts = {
  connectionTimeoutMillis: queryTimeoutMillis + acquireConnectionHeadroomMillis,
  query_timeout: queryTimeoutMillis,
  statement_timeout: statementTimeoutMillis,
} satisfies DatabasePoolTimeouts;
