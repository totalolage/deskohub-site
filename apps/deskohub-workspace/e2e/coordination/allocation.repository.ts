import * as PgClient from "@effect/sql-pg/PgClient";
import { Context, Data, Effect, Layer, Schedule } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  type AllocationOwner,
  allocationOwnerKey,
  allocationPoolName,
  assignQueuedAllocationRequests,
} from "./allocation";

export class AllocationStoreError extends Data.TaggedError(
  "AllocationStoreError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromCause = (cause: unknown) =>
    cause instanceof AllocationStoreError
      ? cause
      : new AllocationStoreError({
          cause,
          message: "Workspace E2E allocation store operation failed.",
        });
}

interface AcquireAllocationInput {
  readonly owner: AllocationOwner;
  readonly preferredShard: number;
  readonly terminalOwners: readonly AllocationOwner[];
}

interface ReleaseAllocationInput {
  readonly owner: AllocationOwner;
  readonly terminalOwners: readonly AllocationOwner[];
}

interface IAllocationRepository {
  readonly acquire: (
    input: AcquireAllocationInput
  ) => Effect.Effect<number | undefined, AllocationStoreError>;
  readonly listOwners: Effect.Effect<
    readonly AllocationOwner[],
    AllocationStoreError
  >;
  readonly release: (
    input: ReleaseAllocationInput
  ) => Effect.Effect<void, AllocationStoreError>;
}

interface PoolRow {
  readonly shardCount: number;
}

interface RequestRow {
  readonly allocatedShard: number | null;
  readonly preferredShard: number;
  readonly queuePosition: number;
  readonly repository: string;
  readonly runAttempt: number;
  readonly runId: number;
}

export class AllocationRepository extends Context.Service<
  AllocationRepository,
  IAllocationRepository
>()("WorkspaceE2E/AllocationRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;

      const listOwners = sql<AllocationOwner>`
        select
          repository,
          run_id::double precision as "runId",
          run_attempt as "runAttempt"
        from workspace_e2e_coordination.allocation_requests
        where pool_name = ${allocationPoolName}
      `.pipe(Effect.mapError(AllocationStoreError.fromCause));

      const acquire = Effect.fn("AllocationRepository.acquire")(function* (
        input: AcquireAllocationInput
      ) {
        return yield* runSerializedTransaction(
          sql,
          Effect.gen(function* () {
            const shardCount = yield* lockAllocationPool(sql);
            yield* deleteTerminalOwners(sql, input.terminalOwners);
            yield* sql`
                insert into workspace_e2e_coordination.allocation_requests (
                  pool_name,
                  repository,
                  run_id,
                  run_attempt,
                  preferred_shard
                ) values (
                  ${allocationPoolName},
                  ${input.owner.repository},
                  ${input.owner.runId},
                  ${input.owner.runAttempt},
                  ${input.preferredShard}
                )
                on conflict (pool_name, repository, run_id, run_attempt)
                do update set last_observed_at = clock_timestamp()
              `;
            const requests = yield* listRequests(sql);
            const assignments = assignQueuedAllocationRequests({
              requests,
              shardCount,
            });
            yield* persistAssignments(sql, assignments);

            const self = allocationOwnerKey(input.owner);
            const existing = requests.find(
              (request) => allocationOwnerKey(request) === self
            )?.allocatedShard;
            return (
              existing ??
              assignments.find(
                ({ owner }) => allocationOwnerKey(owner) === self
              )?.shard
            );
          })
        );
      });

      const release = Effect.fn("AllocationRepository.release")(function* (
        input: ReleaseAllocationInput
      ) {
        yield* runSerializedTransaction(
          sql,
          Effect.gen(function* () {
            const shardCount = yield* lockAllocationPool(sql);
            yield* deleteTerminalOwners(sql, input.terminalOwners);
            yield* deleteOwner(sql, input.owner);
            const requests = yield* listRequests(sql);
            yield* persistAssignments(
              sql,
              assignQueuedAllocationRequests({ requests, shardCount })
            );
          })
        );
      });

      return { acquire, listOwners, release } satisfies IAllocationRepository;
    })
  );
}

const runSerializedTransaction = <A, E, R>(
  sql: PgClient.PgClient,
  operation: Effect.Effect<A, E, R>
) =>
  sql
    .withTransaction(
      Effect.all(
        [
          sql`set transaction isolation level serializable`,
          sql`set local statement_timeout = '30s'`,
          sql`set local idle_in_transaction_session_timeout = '30s'`,
        ],
        { discard: true }
      ).pipe(Effect.andThen(operation))
    )
    .pipe(
      Effect.retry({
        schedule: Schedule.exponential("25 millis"),
        times: 5,
        while: isRetryableSqlError,
      }),
      Effect.mapError(AllocationStoreError.fromCause)
    );

const isRetryableSqlError = (error: unknown): error is SqlError =>
  Boolean(
    error &&
      typeof error === "object" &&
      "reason" in error &&
      typeof error.reason === "object" &&
      error.reason !== null &&
      "isRetryable" in error.reason &&
      error.reason.isRetryable === true
  );

const lockAllocationPool = Effect.fn("AllocationRepository.lockPool")(
  function* (sql: PgClient.PgClient) {
    const rows = yield* sql<PoolRow>`
      select shard_count as "shardCount"
      from workspace_e2e_coordination.allocation_pools
      where name = ${allocationPoolName}
      for update
    `;
    const pool = rows[0];
    if (!pool) {
      return yield* new AllocationStoreError({
        message: "Workspace E2E allocation pool is not provisioned.",
      });
    }
    return pool.shardCount;
  }
);

const listRequests = (sql: PgClient.PgClient) =>
  sql<RequestRow>`
    select
      allocated_shard as "allocatedShard",
      preferred_shard as "preferredShard",
      queue_position::double precision as "queuePosition",
      repository,
      run_attempt as "runAttempt",
      run_id::double precision as "runId"
    from workspace_e2e_coordination.allocation_requests
    where pool_name = ${allocationPoolName}
    order by queue_position
  `;

const deleteTerminalOwners = (
  sql: PgClient.PgClient,
  owners: readonly AllocationOwner[]
) =>
  Effect.forEach(owners, (owner) => deleteOwner(sql, owner), {
    discard: true,
  });

const deleteOwner = (sql: PgClient.PgClient, owner: AllocationOwner) =>
  sql`
    delete from workspace_e2e_coordination.allocation_requests
    where pool_name = ${allocationPoolName}
      and repository = ${owner.repository}
      and run_id = ${owner.runId}
      and run_attempt = ${owner.runAttempt}
  `;

const persistAssignments = (
  sql: PgClient.PgClient,
  assignments: readonly {
    readonly owner: AllocationOwner;
    readonly shard: number;
  }[]
) =>
  Effect.forEach(
    assignments,
    ({ owner, shard }) =>
      sql`
        update workspace_e2e_coordination.allocation_requests
        set
          allocated_shard = ${shard},
          acquired_at = clock_timestamp(),
          last_observed_at = clock_timestamp()
        where pool_name = ${allocationPoolName}
          and repository = ${owner.repository}
          and run_id = ${owner.runId}
          and run_attempt = ${owner.runAttempt}
          and allocated_shard is null
      `,
    { discard: true }
  );
