import { NodeRuntime } from "@effect/platform-node";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, Redacted, Schema } from "effect";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";

const allocatorRoleName = "workspace_e2e_allocator";

const Environment = Schema.Struct({
  WORKSPACE_E2E_COORDINATOR_ADMIN_DATABASE_URL: Schema.NonEmptyString,
});

interface CurrentDatabaseRow {
  readonly databaseName: string;
}

const program = Schema.decodeUnknownEffect(Environment)(process.env).pipe(
  Effect.flatMap((environment) =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const allocatorRole = sql(allocatorRoleName);
      const currentDatabases = yield* sql<CurrentDatabaseRow>`
        select current_database() as "databaseName"
      `;
      const currentDatabase = currentDatabases[0];
      if (!currentDatabase) {
        return yield* Effect.fail(
          new Error(
            "Could not identify the Workspace E2E coordination database."
          )
        );
      }
      const database = sql(currentDatabase.databaseName);

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* provisionStep(
            "seed allocation pool",
            sql`
            insert into workspace_e2e_coordination.allocation_pools (
              name,
              shard_count
            ) values ('dotypos-sandbox', 3)
            on conflict (name)
            do update set shard_count = excluded.shard_count
          `
          );
          yield* provisionStep(
            "revoke public schema access",
            sql`revoke all on schema workspace_e2e_coordination from public`
          );
          yield* provisionStep(
            "reset allocator table grants",
            sql`revoke all on all tables in schema workspace_e2e_coordination from ${allocatorRole}`
          );
          yield* provisionStep(
            "reset allocator sequence grants",
            sql`revoke all on all sequences in schema workspace_e2e_coordination from ${allocatorRole}`
          );
          yield* provisionStep(
            "grant database connect",
            sql`grant connect on database ${database} to ${allocatorRole}`
          );
          yield* provisionStep(
            "grant schema usage",
            sql`grant usage on schema workspace_e2e_coordination to ${allocatorRole}`
          );
          yield* provisionStep(
            "grant pool read and row-lock access",
            sql`grant select, update on workspace_e2e_coordination.allocation_pools to ${allocatorRole}`
          );
          yield* provisionStep(
            "grant allocation request access",
            sql`grant select, insert, update, delete on workspace_e2e_coordination.allocation_requests to ${allocatorRole}`
          );
          yield* provisionStep(
            "grant allocation sequence access",
            sql`grant usage, select on sequence workspace_e2e_coordination.allocation_requests_queue_position_seq to ${allocatorRole}`
          );
        })
      );
    }).pipe(
      Effect.provide(
        PgClient.layer({
          applicationName: "workspace-e2e-coordination-provision",
          connectTimeout: "10 seconds",
          maxConnections: 1,
          url: Redacted.make(
            normalizePostgresConnectionUrl(
              environment.WORKSPACE_E2E_COORDINATOR_ADMIN_DATABASE_URL
            )
          ),
        })
      )
    )
  ),
  Effect.tapError((error) =>
    Effect.logError(
      error instanceof Error
        ? error.message
        : "Workspace E2E coordination provisioning failed."
    )
  )
);

const provisionStep = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError(
      (cause) =>
        new Error(`Coordination provisioning failed at: ${name}`, { cause })
    )
  );

NodeRuntime.runMain(program, { disableErrorReporting: true });
