import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseWorkflow, workflowStepRuns } from "./shared/workflow-contract";
import {
  assertValidMigrationCount,
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

test("regenerates Workspace migrations in CI before accepting them", () => {
  const workflow = parseWorkflow(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-tests.yml")
  );
  const turbo = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../turbo.json"), "utf8")
  ) as {
    readonly tasks: {
      readonly "db:generate": {
        readonly dependsOn: readonly string[];
        readonly env: readonly string[];
      };
    };
  };

  expect(turbo.tasks["db:generate"].dependsOn).toContain("i18n:compile");
  expect(turbo.tasks["db:generate"].env).toEqual(
    expect.arrayContaining(["DATABASE_URL", "DATABASE_URL_UNPOOLED"])
  );

  const runs = workflowStepRuns(workflow).join("\n");
  expect(runs).toContain("bun turbo db:generate --filter=deskohub-workspace");
  expect(runs).toContain(
    "git add --intent-to-add -- apps/deskohub-workspace/db/migrations"
  );
  expect(runs).toContain(
    "git diff --exit-code -- apps/deskohub-workspace/db/migrations"
  );
});
