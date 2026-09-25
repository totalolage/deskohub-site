import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowStep,
  workflowStepNames,
  workflowStepRuns,
  workflowSteps,
} from "./shared/workflow-contract";

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/workspace-tests.yml"
);

const doc = parseWorkflow(workflowPath);
const testJob = doc.jobs["test-functional"];
const stepNames = workflowStepNames(doc);
const docServices = (
  doc as {
    jobs: {
      "test-functional": {
        services?: {
          postgres?: {
            image?: string;
            env?: Record<string, string>;
            options?: string;
          };
        };
      };
    };
  }
).jobs["test-functional"].services;

const stepByName = (name: string): WorkflowStep => {
  const step = findStepByName(doc, name);
  expect(step).toBeDefined();
  return step as WorkflowStep;
};

test("runs the Postgres-backed workspace suites against the disposable service database", () => {
  expect(testJob).toBeDefined();
  // Pinned disposable Postgres service with a UUIDv7-capable image.
  const service = docServices?.postgres;
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

  // Schema validation runs against the same disposable database.
  const schemaStepEnv = stepByName("Validate Workspace schema migration").env;
  expect(schemaStepEnv?.DATABASE_URL).toBe(
    "postgresql://workspace:workspace@127.0.0.1:5432/workspace"
  );
  expect(
    stepByName("Validate Workspace schema migration").run?.includes(
      "bun turbo db:generate --filter=deskohub-workspace"
    )
  ).toBe(true);
  expect(
    workflowSteps(doc, "test-functional").filter((step) =>
      JSON.stringify(step).includes("WORKSPACE_TEST_DATABASE_URL")
    )
  ).toHaveLength(1);
});

test("installs the matching Chromium browser before the Workspace test task", () => {
  const names = stepNames;
  const installIndex = names.indexOf("Install Workspace Playwright Chromium");
  const lintIndex = names.indexOf("Lint Workspace");
  const testIndex = names.indexOf("Run Workspace tests");

  expect(installIndex).toBeGreaterThan(-1);
  expect(installIndex).toBeLessThan(lintIndex);
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
  expect(
    workflowStepRuns(doc).some((run) =>
      run.includes("bun install --frozen-lockfile")
    )
  ).toBe(true);
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
  const envSchema = readFileSync(
    resolve(import.meta.dir, "../env.schema.ts"),
    "utf8"
  );
  const helper = readFileSync(
    resolve(
      import.meta.dir,
      "../shared/testing/workspace-postgres-test-database.test-utils.ts"
    ),
    "utf8"
  );

  // Static absence rules: neither the runtime env schema nor the helper may
  // route the disposable test database through runtime configuration.
  expect(envSchema.includes("WORKSPACE_TEST_DATABASE_URL")).toBe(false);
  expect(helper.includes("process.env.DATABASE_URL")).toBe(false);

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
