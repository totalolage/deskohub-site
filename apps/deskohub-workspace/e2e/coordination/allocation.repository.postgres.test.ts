import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, Layer, Redacted } from "effect";
import { normalizePostgresConnectionUrl } from "@/db/postgres-connection-url";
import { type AllocationOwner, allocationPoolName } from "./allocation";
import { AllocationRepository } from "./allocation.repository";
import { coordinationMigrationStatements } from "./coordination-migrations.test-utils";

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

// The repository runs its own serializable transactions, so it gets a
// disposable database instead of a rolled-back transaction.
const disposableDatabase = `workspace_e2e_coordination_${process.pid}_${Date.now()}`;

const clientLayer = (url: string) =>
  PgClient.layer({
    applicationName: "workspace-e2e-allocation-repository-test",
    maxConnections: 1,
    url: Redacted.make(url),
  });

const runAsAdministrator = <A, E>(
  effect: Effect.Effect<A, E, PgClient.PgClient>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        clientLayer(normalizePostgresConnectionUrl(testDatabaseUrl ?? ""))
      )
    )
  );

const disposableDatabaseUrl = () => {
  const url = new URL(normalizePostgresConnectionUrl(testDatabaseUrl ?? ""));
  url.pathname = `/${disposableDatabase}`;
  return url.toString();
};

const runAgainstCoordination = <A, E>(
  effect: Effect.Effect<A, E, AllocationRepository | PgClient.PgClient>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      yield* sql`delete from workspace_e2e_coordination.allocation_requests`;
      return yield* effect;
    }).pipe(
      Effect.provide(
        AllocationRepository.Default.pipe(
          Layer.provideMerge(clientLayer(disposableDatabaseUrl()))
        )
      )
    )
  );

const owner = (runId: number): AllocationOwner => ({
  repository: "synthetic/repository",
  runAttempt: 1,
  runId,
});

const pullRequestBranch = "feature/shared-preview";
// Run 101 tested the old head and passed its start check before the head
// moved; its cancellation is still pending. Run 102 tested the new head.
const olderHeadRun = owner(101);
const newerHeadRun = owner(102);
// A run for an even older head of the same PR that reached the allocator late.
const lateOlderHeadRun = owner(100);
const otherPullRequestRun = owner(103);

const acquire = (
  runOwner: AllocationOwner,
  previewBranch: string,
  terminalOwners: readonly AllocationOwner[] = []
) =>
  Effect.gen(function* () {
    const repository = yield* AllocationRepository;
    return yield* repository.acquire({
      owner: runOwner,
      preferredShard: 1,
      previewBranch,
      terminalOwners,
    });
  });

const release = (runOwner: AllocationOwner) =>
  Effect.gen(function* () {
    const repository = yield* AllocationRepository;
    yield* repository.release({ owner: runOwner, terminalOwners: [] });
  });

describe.skipIf(!testDatabaseUrl)(
  "Workspace E2E allocation leases against real Postgres",
  () => {
    beforeAll(async () => {
      await runAsAdministrator(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;
          yield* sql`create database ${sql(disposableDatabase)}`;
        })
      );
      const statements = await coordinationMigrationStatements();
      await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;
          for (const statement of statements) {
            yield* sql.unsafe(statement);
          }
          yield* sql`
            insert into workspace_e2e_coordination.allocation_pools (name, shard_count)
            values (${allocationPoolName}, 3)
          `;
        }).pipe(Effect.provide(clientLayer(disposableDatabaseUrl())))
      );
    });

    afterAll(async () => {
      await runAsAdministrator(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;
          yield* sql`drop database if exists ${sql(disposableDatabase)} with (force)`;
        })
      );
    });

    test("holds the newer head's run until the older run releases the preview branch", async () => {
      const outcome = await runAgainstCoordination(
        Effect.gen(function* () {
          const olderShard = yield* acquire(olderHeadRun, pullRequestBranch);
          const newerWhileOlderRuns = yield* acquire(
            newerHeadRun,
            pullRequestBranch
          );
          const otherPullRequestShard = yield* acquire(
            otherPullRequestRun,
            "feature/other"
          );
          const newerWhileCancellationIsDelayed = yield* acquire(
            newerHeadRun,
            pullRequestBranch
          );
          yield* release(olderHeadRun);
          const newerAfterRelease = yield* acquire(
            newerHeadRun,
            pullRequestBranch
          );
          return {
            newerAfterRelease,
            newerWhileCancellationIsDelayed,
            newerWhileOlderRuns,
            olderShard,
            otherPullRequestShard,
          };
        })
      );

      expect(outcome.olderShard).toBe(1);
      expect(outcome.newerWhileOlderRuns).toBeUndefined();
      // A shard was free all along; only the branch held the newer run back.
      expect(outcome.otherPullRequestShard).toBe(2);
      expect(outcome.newerWhileCancellationIsDelayed).toBeUndefined();
      expect(outcome.newerAfterRelease).toBe(1);
    });

    test("reclaims the preview branch once the older run's attempt completes without releasing", async () => {
      const outcome = await runAgainstCoordination(
        Effect.gen(function* () {
          yield* acquire(olderHeadRun, pullRequestBranch);
          const newerWhileOlderRuns = yield* acquire(
            newerHeadRun,
            pullRequestBranch
          );
          const newerAfterOlderCompleted = yield* acquire(
            newerHeadRun,
            pullRequestBranch,
            [olderHeadRun]
          );
          return { newerAfterOlderCompleted, newerWhileOlderRuns };
        })
      );

      expect(outcome.newerWhileOlderRuns).toBeUndefined();
      expect(outcome.newerAfterOlderCompleted).toBe(1);
    });

    test("never lets a late older run displace or overtake the newer head's run", async () => {
      const outcome = await runAgainstCoordination(
        Effect.gen(function* () {
          const newerShard = yield* acquire(newerHeadRun, pullRequestBranch);
          const lateWhileNewerHolds = yield* acquire(
            lateOlderHeadRun,
            pullRequestBranch
          );
          const newerStillHolds = yield* acquire(
            newerHeadRun,
            pullRequestBranch
          );
          return { lateWhileNewerHolds, newerShard, newerStillHolds };
        })
      );

      expect(outcome.newerShard).toBe(1);
      expect(outcome.lateWhileNewerHolds).toBeUndefined();
      expect(outcome.newerStillHolds).toBe(1);

      const queued = await runAgainstCoordination(
        Effect.gen(function* () {
          yield* acquire(olderHeadRun, pullRequestBranch);
          yield* acquire(newerHeadRun, pullRequestBranch);
          yield* acquire(lateOlderHeadRun, pullRequestBranch);
          yield* release(olderHeadRun);
          return {
            late: yield* acquire(lateOlderHeadRun, pullRequestBranch),
            newer: yield* acquire(newerHeadRun, pullRequestBranch),
          };
        })
      );

      // The newer run queued first, so it gets the branch the older run freed.
      expect(queued.newer).toBe(1);
      expect(queued.late).toBeUndefined();
    });

    test("rejects a second holder of one preview branch in the store itself", async () => {
      const outcome = await runAgainstCoordination(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;
          yield* acquire(olderHeadRun, pullRequestBranch);
          yield* acquire(newerHeadRun, pullRequestBranch);
          return yield* sql`
            update workspace_e2e_coordination.allocation_requests
            set allocated_shard = 2, acquired_at = clock_timestamp()
            where run_id = ${newerHeadRun.runId}
          `.pipe(
            Effect.as("allocated" as const),
            Effect.catch(() => Effect.succeed("rejected" as const))
          );
        })
      );

      expect(outcome).toBe("rejected");
    });
  }
);
