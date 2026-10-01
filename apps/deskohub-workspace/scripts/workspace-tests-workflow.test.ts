import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { identifierNames, parseTrackedSource } from "./shared/source-ast";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowStep,
  workflowStepRuns,
  workflowSteps,
} from "./shared/workflow-contract";

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/workspace-tests.yml"
);

const doc = parseWorkflow(workflowPath);
const testJob = doc.jobs["test-functional-shards"];
const shardContract = testJob as typeof testJob & {
  readonly services?: {
    readonly postgres?: {
      readonly image?: string;
      readonly env?: Record<string, string>;
      readonly options?: string;
    };
  };
  readonly strategy?: {
    readonly "fail-fast"?: boolean;
    readonly matrix?: { readonly shard?: readonly number[] };
  };
};
const validationJob = doc.jobs["validate-workspace"];
const validationServices = (
  validationJob as typeof validationJob & {
    readonly services?: {
      readonly postgres?: {
        readonly image?: string;
        readonly env?: Record<string, string>;
        readonly options?: string;
      };
    };
  }
).services;

const stepByName = (name: string): WorkflowStep => {
  const step = findStepByName(doc, name);
  expect(step).toBeDefined();
  return step as WorkflowStep;
};

test("runs each Workspace shard against its disposable Postgres service", () => {
  expect(testJob).toBeDefined();
  expect(validationJob).toBeDefined();
  // Pinned disposable Postgres service with a UUIDv7-capable image.
  const service = shardContract.services?.postgres;
  expect(service?.image).toBe("ghcr.io/fboulnois/pg_uuidv7:1.7.0");
  expect(service?.image?.includes(":latest")).toBe(false);
  expect(service?.env).toEqual({
    POSTGRES_USER: "workspace",
    POSTGRES_PASSWORD: "workspace",
    POSTGRES_DB: "workspace",
  });
  expect(service?.options?.includes("pg_isready")).toBe(true);

  // The test step reads the disposable database; no repository secrets.
  const testStepEnv = stepByName("Run Workspace tests").env;
  expect(testStepEnv?.WORKSPACE_TEST_DATABASE_URL).toBe(
    "postgresql://workspace:workspace@127.0.0.1:5432/workspace"
  );
  expect(JSON.stringify(testStepEnv).includes("secrets.")).toBe(false);

  // Schema validation has its own disposable service database.
  const schemaStepEnv = stepByName("Validate Workspace schema migration").env;
  expect(schemaStepEnv?.DATABASE_URL).toBe(
    "postgresql://workspace:workspace@127.0.0.1:5432/workspace"
  );
  expect(validationServices?.postgres?.image).toBe(service?.image);
  expect(
    stepByName("Validate Workspace schema migration").run?.includes(
      "bun turbo db:generate --filter=deskohub-workspace"
    )
  ).toBe(true);
  expect(
    workflowSteps(doc, "test-functional-shards").filter((step) =>
      JSON.stringify(step).includes("WORKSPACE_TEST_DATABASE_URL")
    )
  ).toHaveLength(1);
});

test("installs the matching Chromium browser before the Workspace test task", () => {
  const names = workflowSteps(doc, "test-functional-shards").map(
    (step) => step.name ?? ""
  );
  const installIndex = names.indexOf("Install Workspace Playwright Chromium");
  const testIndex = names.indexOf("Run Workspace tests");

  expect(installIndex).toBeGreaterThan(-1);
  expect(installIndex).toBeLessThan(testIndex);

  const browserStep = stepByName("Install Workspace Playwright Chromium");
  expect(browserStep["working-directory"]).toBe("apps/deskohub-workspace");
  expect(browserStep.run).toBe(
    "bun ./node_modules/@playwright/test/cli.js install --with-deps chromium"
  );
  expect(JSON.stringify(browserStep).includes("npx")).toBe(false);
  expect(
    names.filter((name) => name === "Install Workspace Playwright Chromium")
  ).toHaveLength(1);
  const shardExpression = "$" + "{{ matrix.shard }}";
  expect(stepByName("Run Workspace tests").run).toContain(
    `--shard=${shardExpression}/4`
  );
  expect(stepByName("Run Workspace tests").run).toContain("bun turbo test");
  expect(
    workflowStepRuns(doc).some((run) =>
      run.includes("bun install --frozen-lockfile")
    )
  ).toBe(true);
});

test("runs four serial Bun test shards and keeps test-functional as a fail-closed gate", () => {
  expect(shardContract.strategy).toEqual({
    "fail-fast": false,
    matrix: { shard: [1, 2, 3, 4] },
  });

  const packageJson = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")
  ) as { readonly scripts: { readonly test: string } };
  expect(packageJson.scripts.test).toContain("--parallel=1");

  const gate = doc.jobs["test-functional"];
  expect(gate.needs).toEqual([
    "validate-workspace",
    "validate-workspace-migrations",
    "test-functional-shards",
  ]);
  expect(gate.if).toContain("always()");
  expect(gate.if).toContain("github.event.action != 'converted_to_draft'");

  const gateStep = workflowSteps(doc, "test-functional")[0];
  expect(gateStep?.env).toEqual({
    VALIDATION_RESULT: "$" + "{{ needs.validate-workspace.result }}",
    MIGRATION_COUNT_RESULT:
      "$" + "{{ needs.validate-workspace-migrations.result }}",
    FUNCTIONAL_SHARDS_RESULT: "$" + "{{ needs.test-functional-shards.result }}",
  });
  const expectedResults = {
    VALIDATION_RESULT: "success",
    MIGRATION_COUNT_RESULT: "success",
    FUNCTIONAL_SHARDS_RESULT: "success",
  };
  const runGate = (overrides: Partial<typeof expectedResults> = {}) =>
    Bun.spawnSync({
      cmd: ["bash", "-e", "-o", "pipefail", "-c", gateStep?.run ?? ""],
      env: { ...process.env, ...expectedResults, ...overrides },
      stderr: "pipe",
      stdout: "pipe",
    });
  expect(runGate().exitCode).toBe(0);
  const resultNames = [
    "VALIDATION_RESULT",
    "MIGRATION_COUNT_RESULT",
    "FUNCTIONAL_SHARDS_RESULT",
  ] as const;
  for (const resultName of resultNames) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(runGate({ [resultName]: result }).exitCode).not.toBe(0);
    }
  }

  const validationSteps = workflowSteps(doc, "validate-workspace");
  expect(validationSteps.some((step) => step.name === "Lint Workspace")).toBe(
    true
  );
  expect(
    validationSteps.some(
      (step) => step.name === "Validate Workspace schema migration"
    )
  ).toBe(true);
  expect(
    validationSteps.some(
      (step) => step.name === "Validate Workspace E2E allocation bundle"
    )
  ).toBe(true);
  expect(
    validationSteps.some((step) => step.run === "bun turbo typecheck")
  ).toBe(true);
  expect(
    workflowSteps(doc, "test-functional-shards").some(
      (step) => step.name === "Lint Workspace"
    )
  ).toBe(false);
});

test("passes the disposable test database through Turborepo at the test task only", () => {
  const turbo = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../turbo.json"), "utf8")
  ) as {
    readonly tasks: {
      readonly test?: {
        readonly cache?: boolean;
        readonly passThroughEnv?: readonly string[];
      };
    };
  };
  const rootTurbo = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../../turbo.json"), "utf8")
  ) as { readonly globalPassThroughEnv?: readonly string[] };

  expect(
    (turbo.tasks.test.passThroughEnv as readonly string[]).includes(
      "WORKSPACE_TEST_DATABASE_URL"
    )
  ).toBe(true);
  expect(turbo.tasks.test.cache).toBe(false);
  expect(
    JSON.stringify(turbo.tasks).split("WORKSPACE_TEST_DATABASE_URL").length - 1
  ).toBe(1);
  expect(
    JSON.stringify(rootTurbo.globalPassThroughEnv).includes(
      "WORKSPACE_TEST_DATABASE_URL"
    )
  ).toBe(false);
});

test("keeps the disposable test database out of runtime configuration", async () => {
  // Static absence rules come from the parsed modules: an identifier exists
  // only in live syntax, so commented-out wiring can never satisfy or fail
  // the checks.
  const envSchema = parseTrackedSource(
    resolve(import.meta.dir, "../env.schema.ts")
  );
  const helper = parseTrackedSource(
    resolve(
      import.meta.dir,
      "../shared/testing/workspace-postgres-test-database.test-utils.ts"
    )
  );

  // Neither the runtime env schema nor the helper may route the disposable
  // test database through runtime configuration.
  expect(
    identifierNames(envSchema.ast).has("WORKSPACE_TEST_DATABASE_URL")
  ).toBe(false);
  expect(identifierNames(helper.ast).has("DATABASE_URL")).toBe(false);

  // The helper/preload positive wiring is covered by execution: this very
  // test process ran the preload, which mirrors the disposable database into
  // the runtime DATABASE_URL whenever it is configured, and the helper reads
  // the same variable.
  const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;
  if (testDatabaseUrl !== undefined) {
    expect(process.env.DATABASE_URL).toBe(testDatabaseUrl);
  }
  const { connectWorkspacePostgresTestDatabase } = await import(
    "../shared/testing/workspace-postgres-test-database.test-utils"
  );
  expect(connectWorkspacePostgresTestDatabase).toBeDefined();
});
