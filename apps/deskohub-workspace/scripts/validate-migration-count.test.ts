import { describe, expect, test } from "bun:test";
import {
  assertValidMigrationCount,
  candidateMigrationDiffRange,
  parseChangedMigrationPaths,
} from "./validate-migration-count";

describe("parseChangedMigrationPaths", () => {
  test("returns non-empty migration paths", () => {
    expect(
      parseChangedMigrationPaths(`
apps/deskohub-workspace/db/migrations/0002_minor_magik.sql
apps/deskohub-workspace/db/migrations/20260720120000_new_migration/migration.sql
`)
    ).toEqual([
      "apps/deskohub-workspace/db/migrations/0002_minor_magik.sql",
      "apps/deskohub-workspace/db/migrations/20260720120000_new_migration/migration.sql",
    ]);
  });

  test("returns an empty list when no migrations changed", () => {
    expect(parseChangedMigrationPaths("\n")).toEqual([]);
  });
});

describe("candidateMigrationDiffRange", () => {
  test("compares the candidate tree to the current integration tree", () => {
    expect(candidateMigrationDiffRange("current-main")).toBe(
      "current-main..HEAD"
    );
    expect(candidateMigrationDiffRange("current-main", "candidate")).toBe(
      "current-main..candidate"
    );
  });
});

describe("assertValidMigrationCount", () => {
  test("allows at most one migration", () => {
    expect(() => assertValidMigrationCount([])).not.toThrow();
    expect(() => assertValidMigrationCount(["0001.sql"])).not.toThrow();
  });

  test("reports every migration when more than one changed", () => {
    expect(() => assertValidMigrationCount(["0001.sql", "0002.sql"])).toThrow(
      "Workspace PRs may introduce at most one Drizzle SQL migration; found 2.\n0001.sql\n0002.sql"
    );
  });
});
