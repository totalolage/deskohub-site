import { describe, expect, test } from "bun:test";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Data, Effect, Exit, Redacted } from "effect";
import { normalizePostgresConnectionUrl } from "@/db/postgres-connection-url";
import { coordinationMigrationStatements } from "@/e2e/coordination/coordination-migrations.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { provisionWorkspaceE2ECoordination } from "./workspace-e2e-coordination-provision";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const allocatorRole = "workspace_e2e_allocator";
const providerPermitRole = "workspace_e2e_provider_permit";

class DisposableTransactionRollback extends Data.TaggedError(
  "DisposableTransactionRollback"
) {}

class RoleProbeRollback extends Data.TaggedError("RoleProbeRollback") {}

const createLoginRole = (sql: PgClient.PgClient, role: string) =>
  sql.unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${role}') then
        create role ${role} login;
      end if;
    end
    $$
  `);

/**
 * Prepares a coordination database the way `e2e:coordination:provision` finds
 * it: both roles exist, the coordination migrations are applied, and stale
 * grants from an earlier provisioning are present.
 */
const prepareCoordinationDatabase = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  yield* createLoginRole(sql, allocatorRole);
  yield* createLoginRole(sql, providerPermitRole);
  const statements = yield* Effect.promise(coordinationMigrationStatements);
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
  yield* sql`grant usage on schema workspace_e2e_coordination to public`;
  yield* sql`grant all on all tables in schema workspace_e2e_coordination to ${sql(allocatorRole)}`;
  yield* sql`grant all on all sequences in schema workspace_e2e_coordination to ${sql(allocatorRole)}`;
  yield* sql.unsafe(`
    do $$
    begin
      execute format('grant create on database %I to ${providerPermitRole}', current_database());
    end
    $$
  `);
  yield* sql`grant usage on schema workspace_e2e_coordination to ${sql(providerPermitRole)}`;
  yield* sql`grant select on all tables in schema workspace_e2e_coordination to ${sql(providerPermitRole)}`;
  yield* sql`grant usage, select on all sequences in schema workspace_e2e_coordination to ${sql(providerPermitRole)}`;
});

/**
 * Runs the effect inside one transaction that is always rolled back, so the
 * coordination schema and the cluster-wide roles never outlive the test.
 */
const inDisposableTransaction = <A, E>(
  effect: Effect.Effect<A, E, PgClient.PgClient>
) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    let outcome: Exit.Exit<A, E> | undefined;
    yield* sql
      .withTransaction(
        Effect.exit(effect).pipe(
          Effect.flatMap((exit) => {
            outcome = exit;
            return Effect.fail(new DisposableTransactionRollback());
          })
        )
      )
      .pipe(
        Effect.catchTag("DisposableTransactionRollback", () => Effect.void)
      );
    if (!outcome) throw new Error("The disposable transaction did not run.");
    return outcome;
  });

/**
 * Runs one statement as the role inside a savepoint that is always rolled
 * back, and reports whether Postgres allowed it.
 */
const roleMayRun = (role: string, statement: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`set local role ${sql(role)}`;
          yield* sql.unsafe(statement);
          return yield* new RoleProbeRollback();
        })
      )
      .pipe(
        Effect.catchTag("RoleProbeRollback", () => Effect.succeed(true)),
        Effect.catchReason("SqlError", "AuthorizationError", () =>
          Effect.succeed(false)
        )
      );
  });

const runAgainstTestDatabase = <A, E>(
  effect: Effect.Effect<A, E, PgClient.PgClient>
) =>
  Effect.runPromise(
    inDisposableTransaction(effect).pipe(
      Effect.provide(
        PgClient.layer({
          applicationName: "workspace-e2e-coordination-provision-test",
          maxConnections: 1,
          url: Redacted.make(
            normalizePostgresConnectionUrl(
              process.env.WORKSPACE_TEST_DATABASE_URL ?? ""
            )
          ),
        })
      )
    )
  );

const roleProbes = {
  allocatorLocksPool: [
    allocatorRole,
    "select name from workspace_e2e_coordination.allocation_pools where name = 'dotypos-sandbox' for update",
  ],
  allocatorUpdatesPool: [
    allocatorRole,
    "update workspace_e2e_coordination.allocation_pools set shard_count = shard_count where name = 'dotypos-sandbox'",
  ],
  allocatorInsertsPool: [
    allocatorRole,
    "insert into workspace_e2e_coordination.allocation_pools (name, shard_count) values ('synthetic-pool', 3)",
  ],
  allocatorDeletesPool: [
    allocatorRole,
    "delete from workspace_e2e_coordination.allocation_pools",
  ],
  allocatorManagesRequests: [
    allocatorRole,
    `with requested as (
       insert into workspace_e2e_coordination.allocation_requests
         (pool_name, repository, run_id, run_attempt, preferred_shard)
       values ('dotypos-sandbox', 'synthetic/repository', 1, 1, 1)
       returning run_id
     )
     update workspace_e2e_coordination.allocation_requests
        set last_observed_at = now()
      where run_id in (select run_id from requested)`,
  ],
  allocatorDeletesRequests: [
    allocatorRole,
    "delete from workspace_e2e_coordination.allocation_requests",
  ],
  allocatorReadsQueueSequence: [
    allocatorRole,
    "select last_value from workspace_e2e_coordination.allocation_requests_queue_position_seq",
  ],
  allocatorResetsQueueSequence: [
    allocatorRole,
    "select setval('workspace_e2e_coordination.allocation_requests_queue_position_seq', 1)",
  ],
  providerPermitResolvesSchemaObjects: [
    providerPermitRole,
    "select 'workspace_e2e_coordination.allocation_pools'::regclass",
  ],
  providerPermitCreatesSchemas: [
    providerPermitRole,
    "create schema synthetic_provider_permit_schema",
  ],
  providerPermitReadsPools: [
    providerPermitRole,
    "select name from workspace_e2e_coordination.allocation_pools",
  ],
  providerPermitReadsRequests: [
    providerPermitRole,
    "select run_id from workspace_e2e_coordination.allocation_requests",
  ],
  providerPermitReadsQueueSequence: [
    providerPermitRole,
    "select last_value from workspace_e2e_coordination.allocation_requests_queue_position_seq",
  ],
} as const satisfies Record<string, readonly [string, string]>;

type RoleProbe = keyof typeof roleProbes;

describe.skipIf(!postgresDatabase)(
  "Workspace E2E coordination provisioning against real Postgres",
  () => {
    test("leaves the allocator only pool row-locking and request access, and the provider permit no schema access", async () => {
      const outcome = await runAgainstTestDatabase(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;
          yield* prepareCoordinationDatabase;
          yield* provisionWorkspaceE2ECoordination;
          const allowed: Partial<Record<RoleProbe, boolean>> = {};
          for (const [probe, [role, statement]] of Object.entries(roleProbes)) {
            allowed[probe as RoleProbe] = yield* roleMayRun(role, statement);
          }
          // Table and sequence grants are checked directly as well: schema
          // access alone would otherwise mask a stale grant from reads.
          const providerPermitGrants = yield* sql<{
            readonly holdsObjectGrants: boolean;
          }>`
            select
              has_table_privilege(${providerPermitRole}, 'workspace_e2e_coordination.allocation_pools', 'select, insert, update, delete')
              or has_table_privilege(${providerPermitRole}, 'workspace_e2e_coordination.allocation_requests', 'select, insert, update, delete')
              or has_sequence_privilege(${providerPermitRole}, 'workspace_e2e_coordination.allocation_requests_queue_position_seq', 'usage, select')
              as "holdsObjectGrants"
          `;
          return {
            ...allowed,
            providerPermitHoldsObjectGrants:
              providerPermitGrants[0]?.holdsObjectGrants,
          };
        })
      );

      expect(Exit.isSuccess(outcome) ? outcome.value : outcome).toEqual({
        allocatorLocksPool: true,
        allocatorUpdatesPool: true,
        allocatorInsertsPool: false,
        allocatorDeletesPool: false,
        allocatorManagesRequests: true,
        allocatorDeletesRequests: true,
        allocatorReadsQueueSequence: true,
        allocatorResetsQueueSequence: false,
        providerPermitResolvesSchemaObjects: false,
        providerPermitCreatesSchemas: false,
        providerPermitReadsPools: false,
        providerPermitReadsRequests: false,
        providerPermitReadsQueueSequence: false,
        providerPermitHoldsObjectGrants: false,
      });
    });

    test("refuses a provider permit role that inherits another role", async () => {
      const outcome = await runAgainstTestDatabase(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient;
          yield* prepareCoordinationDatabase;
          yield* sql`grant ${sql(allocatorRole)} to ${sql(providerPermitRole)}`;
          return yield* provisionWorkspaceE2ECoordination;
        })
      );

      expect(Exit.isFailure(outcome)).toBe(true);
      expect(String(Exit.isFailure(outcome) ? outcome.cause : "")).toContain(
        "The provider permit role is not isolated."
      );
    });
  }
);
