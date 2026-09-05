import { describe, expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  type CliSessionRow,
  cliAuthenticationRequests,
  cliSessions,
} from "./cli-authentication";

const approvedByCheckName = "cli_sessions_approved_by_check";
const approvedByFormat = "'^[a-z0-9][a-z0-9._-]{0,79}$'";
const approvedByBackfill =
  'UPDATE "cli_sessions" SET "approved_by" = \'admin\' WHERE "approved_by" IS NULL';
const approvedByNotNull =
  'ALTER TABLE "cli_sessions" ALTER COLUMN "approved_by" SET NOT NULL';
const approvedByConstraint = `ADD CONSTRAINT "${approvedByCheckName}" CHECK ("approved_by" ~ ${approvedByFormat})`;

describe("cli session ownership persistence", () => {
  test("backfills legacy ownerless sessions before enforcing ownership", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260904133315_peaceful_talisman/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain(approvedByBackfill);
    expect(migration).toContain(approvedByNotNull);
    expect(migration).toContain(approvedByConstraint);
    expect(migration).toContain(
      `DROP CONSTRAINT "${approvedByCheckName}", ${approvedByConstraint}`
    );
    expect(migration.indexOf(approvedByBackfill)).toBeLessThan(
      migration.indexOf(approvedByNotNull)
    );
    expect(migration.indexOf(approvedByBackfill)).toBeLessThan(
      migration.indexOf(approvedByConstraint)
    );
  });

  test("leaves pending authentication requests without an enforced approver", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260904133315_peaceful_talisman/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).not.toContain("cli_authentication_requests");
    expect(
      getTableConfig(cliAuthenticationRequests).columns.find(
        ({ name }) => name === "approved_by"
      )?.notNull
    ).toBe(false);
  });

  test("makes every session row owned by a syntactically valid administrator", () => {
    const config = getTableConfig(cliSessions);
    const approvedBy = config.columns.find(
      ({ name }) => name === "approved_by"
    );
    const approvedByCheck = config.checks.find(
      ({ name }) => name === approvedByCheckName
    );

    expect(approvedBy?.notNull).toBe(true);
    expect(approvedByCheck?.name).toBe(approvedByCheckName);
    expect(
      new PgDialect().sqlToQuery(approvedByCheck?.value as never).sql
    ).toBe(`"cli_sessions"."approved_by" ~ ${approvedByFormat}`);
  });

  test("infers non-null owners on selected session rows", () => {
    const ownerRequired: null extends CliSessionRow["approvedBy"]
      ? false
      : true = true;

    expect(ownerRequired).toBe(true);
  });
});
