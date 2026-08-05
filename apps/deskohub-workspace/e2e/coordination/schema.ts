import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const workspaceE2eCoordination = pgSchema("workspace_e2e_coordination");

export const allocationPools = workspaceE2eCoordination.table(
  "allocation_pools",
  {
    name: text().primaryKey(),
    shardCount: smallint("shard_count").notNull(),
  },
  (table) => [
    check("allocation_pools_shard_count_check", sql`${table.shardCount} = 3`),
  ]
);

export const allocationRequests = workspaceE2eCoordination.table(
  "allocation_requests",
  {
    poolName: text("pool_name")
      .notNull()
      .references(() => allocationPools.name),
    repository: text().notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    runAttempt: integer("run_attempt").notNull(),
    preferredShard: smallint("preferred_shard").notNull(),
    queuePosition: bigint("queue_position", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
    allocatedShard: smallint("allocated_shard"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.poolName,
        table.repository,
        table.runId,
        table.runAttempt,
      ],
    }),
    uniqueIndex("allocation_requests_pool_queue_unique_idx").on(
      table.poolName,
      table.queuePosition
    ),
    uniqueIndex("allocation_requests_one_owner_per_shard_idx")
      .on(table.poolName, table.allocatedShard)
      .where(sql`${table.allocatedShard} is not null`),
    check("allocation_requests_run_id_check", sql`${table.runId} > 0`),
    check(
      "allocation_requests_run_attempt_check",
      sql`${table.runAttempt} > 0`
    ),
    check(
      "allocation_requests_preferred_shard_check",
      sql`${table.preferredShard} between 1 and 3`
    ),
    check(
      "allocation_requests_allocated_shard_check",
      sql`${table.allocatedShard} is null or ${table.allocatedShard} between 1 and 3`
    ),
    check(
      "allocation_requests_acquired_state_check",
      sql`(${table.allocatedShard} is null) = (${table.acquiredAt} is null)`
    ),
  ]
);
