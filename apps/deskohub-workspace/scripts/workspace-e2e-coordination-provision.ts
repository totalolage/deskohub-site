import { NodeRuntime } from "@effect/platform-node";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, Redacted, Schema } from "effect";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";

const allocatorRoleName = "workspace_e2e_allocator";
const providerPermitRoleName = "workspace_e2e_provider_permit";

const Environment = Schema.Struct({
  WORKSPACE_E2E_COORDINATOR_ADMIN_DATABASE_URL: Schema.NonEmptyString,
});

interface CurrentDatabaseRow {
  readonly databaseName: string;
}

interface ProviderPermitRoleSecurityRow {
  readonly canBypassRowSecurity: boolean;
  readonly canCreateDatabase: boolean;
  readonly canCreateRole: boolean;
  readonly canLogin: boolean;
  readonly hasMemberships: boolean;
  readonly isReplicationRole: boolean;
  readonly isSuperuser: boolean;
}

const program = Schema.decodeUnknownEffect(Environment)(process.env).pipe(
  Effect.flatMap((environment) =>
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const allocatorRole = sql(allocatorRoleName);
      const providerPermitRole = sql(providerPermitRoleName);
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
          yield* provisionStep(
            "reset provider permit database grants",
            sql`revoke all privileges on database ${database} from ${providerPermitRole}`
          );
          yield* provisionStep(
            "reset provider permit schema grants",
            sql`revoke all on schema workspace_e2e_coordination from ${providerPermitRole}`
          );
          yield* provisionStep(
            "reset provider permit table grants",
            sql`revoke all on all tables in schema workspace_e2e_coordination from ${providerPermitRole}`
          );
          yield* provisionStep(
            "reset provider permit sequence grants",
            sql`revoke all on all sequences in schema workspace_e2e_coordination from ${providerPermitRole}`
          );
          yield* provisionStep(
            "grant provider permit database connect",
            sql`grant connect on database ${database} to ${providerPermitRole}`
          );
          const providerPermitRoles = yield* provisionStep(
            "verify provider permit role isolation",
            sql<ProviderPermitRoleSecurityRow>`
              select
                role.rolbypassrls as "canBypassRowSecurity",
                role.rolcreatedb as "canCreateDatabase",
                role.rolcreaterole as "canCreateRole",
                role.rolcanlogin as "canLogin",
                exists (
                  select 1
                  from pg_auth_members membership
                  where membership.member = role.oid
                ) as "hasMemberships",
                role.rolreplication as "isReplicationRole",
                role.rolsuper as "isSuperuser"
              from pg_roles role
              where role.rolname = ${providerPermitRoleName}
            `
          );
          const providerPermitRoleSecurity = providerPermitRoles[0];
          if (
            providerPermitRoles.length !== 1 ||
            !providerPermitRoleSecurity?.canLogin ||
            providerPermitRoleSecurity.canBypassRowSecurity ||
            providerPermitRoleSecurity.canCreateDatabase ||
            providerPermitRoleSecurity.canCreateRole ||
            providerPermitRoleSecurity.hasMemberships ||
            providerPermitRoleSecurity.isReplicationRole ||
            providerPermitRoleSecurity.isSuperuser
          ) {
            return yield* Effect.fail(
              new Error("The provider permit role is not isolated.")
            );
          }
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
