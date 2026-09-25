import { expect, test } from "bun:test";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, Layer } from "effect";
import { provisionWorkspaceE2ECoordination } from "./workspace-e2e-coordination-provision";

interface ExecutedStatement {
  readonly text: string;
}

const allocatorRole = "workspace_e2e_allocator";
const providerPermitRole = "workspace_e2e_provider_permit";

const providerPermitIsolationRow = {
  canBypassRowSecurity: false,
  canCreateDatabase: false,
  canCreateRole: false,
  canLogin: true,
  hasMemberships: false,
  isReplicationRole: false,
  isSuperuser: false,
};

/**
 * Recording fake for the PgClient service: captures every executed statement
 * and answers the two reads the provisioner performs. The real provision
 * program runs; only Postgres is fake.
 */
interface SqlFragment {
  readonly __fragment: string;
}

interface SqlFragment {
  readonly __fragment: string;
}

const render = (
  strings: TemplateStringsArray,
  values: readonly SqlFragment[]
): string =>
  strings
    .map((part, index) => `${part}${values[index]?.__fragment ?? "?"}`)
    .join("");

const makeRecordingSqlClient = (
  executed: ExecutedStatement[]
): PgClient.PgClient => {
  const run = (
    strings: TemplateStringsArray,
    values: readonly SqlFragment[]
  ) => {
    const text = render(strings, values);
    executed.push({ text });
    if (text.includes("current_database()")) {
      return Effect.succeed([{ databaseName: "coordination" }]);
    }
    if (text.includes("from pg_roles role")) {
      return Effect.succeed([providerPermitIsolationRow]);
    }
    return Effect.succeed([]);
  };
  const sql = ((
    first: TemplateStringsArray | string,
    ...values: readonly SqlFragment[]
  ): unknown =>
    Array.isArray(first)
      ? run(first, values)
      : { __fragment: first }) as PgClient.PgClient;
  return Object.assign(sql, {
    withTransaction: <A>(effect: A): A => effect,
  });
};

test("provisions allocator and provider-permit privileges by executing the real provisioner", async () => {
  const executed: ExecutedStatement[] = [];
  const clientLayer = Layer.succeed(
    PgClient.PgClient,
    makeRecordingSqlClient(executed)
  );

  await Effect.runPromise(
    provisionWorkspaceE2ECoordination.pipe(Effect.provide(clientLayer))
  );

  const statements = executed.map(({ text }) => text);
  const allocatorStatements = statements.filter((text) =>
    text.includes(allocatorRole)
  );
  const providerStatements = statements.filter((text) =>
    text.includes(providerPermitRole)
  );

  // The runtime allocator gets exactly the pool access needed for row
  // locking, plus its request/sequence access, never the whole table.
  expect(
    statements.some((text) =>
      text.includes(
        "grant select, update on workspace_e2e_coordination.allocation_pools"
      )
    )
  ).toBe(true);
  expect(
    statements.some((text) =>
      text.includes("grant all on workspace_e2e_coordination.allocation_pools")
    )
  ).toBe(false);
  expect(
    allocatorStatements.some((text) =>
      text.includes(
        "grant select, insert, update, delete on workspace_e2e_coordination.allocation_requests"
      )
    )
  ).toBe(true);
  expect(
    allocatorStatements.some((text) =>
      text.includes(
        "grant usage, select on sequence workspace_e2e_coordination.allocation_requests_queue_position_seq"
      )
    )
  ).toBe(true);

  // The provider permit role keeps connectivity only: database privileges
  // are revoked, and no schema usage, table, sequence, or pool access is
  // ever granted to it.
  expect(
    providerStatements.some((text) =>
      text.includes("revoke all privileges on database")
    )
  ).toBe(true);
  expect(
    providerStatements.some((text) =>
      text.includes("revoke all on all tables in schema")
    )
  ).toBe(true);
  expect(
    providerStatements.some((text) =>
      text.includes("revoke all on all sequences in schema")
    )
  ).toBe(true);
  expect(
    providerStatements.some((text) =>
      text.includes("grant connect on database")
    )
  ).toBe(true);
  expect(
    providerStatements.filter((text) => text.startsWith("grant "))
  ).toEqual([expect.stringContaining("grant connect on database")]);

  // The executed isolation probe really inspects role flags and membership.
  const isolationProbe = statements.find((text) =>
    text.includes("from pg_roles role")
  );
  expect(isolationProbe).toBeDefined();
  expect(isolationProbe).toContain("rolsuper");
  expect(isolationProbe).toContain("pg_auth_members");
});
