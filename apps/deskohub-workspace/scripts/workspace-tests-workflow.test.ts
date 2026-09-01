import { expect, test } from "bun:test";
import { resolve } from "node:path";

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/workspace-tests.yml"
);

test("runs the Postgres-backed workspace suites against the disposable service database", async () => {
  const workflow = await Bun.file(workflowPath).text();
  const testJob = workflow.slice(workflow.indexOf("  test-functional:"));
  const testStep = testJob.slice(
    testJob.indexOf("- name: Run Workspace tests")
  );
  const schemaStep = testJob.slice(
    testJob.indexOf("- name: Validate Workspace schema migration"),
    testJob.indexOf("- name: Validate Workspace E2E allocation bundle")
  );

  expect(testJob).toContain("image: ghcr.io/fboulnois/pg_uuidv7:1.7.0");
  expect(testJob).not.toContain("pg_uuidv7:latest");
  expect(testJob).toContain("POSTGRES_USER: workspace");
  expect(testJob).toContain("POSTGRES_PASSWORD: workspace");
  expect(testJob).toContain("POSTGRES_DB: workspace");
  expect(testJob).toContain("pg_isready");
  expect(testStep).toContain(
    "WORKSPACE_TEST_DATABASE_URL: postgresql://workspace:workspace@127.0.0.1:5432/workspace"
  );
  expect(testStep).not.toContain("secrets.");
  expect(schemaStep).toContain(
    "DATABASE_URL: postgresql://workspace:workspace@127.0.0.1:5432/workspace"
  );
  expect(schemaStep).toContain(
    "bun turbo db:generate --filter=deskohub-workspace"
  );
  expect(testJob.split("WORKSPACE_TEST_DATABASE_URL").length - 1).toBe(1);
});

test("passes the disposable test database through Turborepo at the test task only", async () => {
  const turbo = await Bun.file(
    resolve(import.meta.dir, "../turbo.json")
  ).json();
  const rootTurbo = await Bun.file(
    resolve(import.meta.dir, "../../../turbo.json")
  ).json();

  expect(turbo.tasks.test.passThroughEnv as string[]).toContain(
    "WORKSPACE_TEST_DATABASE_URL"
  );
  expect(turbo.tasks.test.cache).toBe(false);
  expect(
    JSON.stringify(turbo.tasks).split("WORKSPACE_TEST_DATABASE_URL").length - 1
  ).toBe(1);
  expect(JSON.stringify(rootTurbo.globalPassThroughEnv)).not.toContain(
    "WORKSPACE_TEST_DATABASE_URL"
  );
});

test("keeps the disposable test database out of runtime configuration", async () => {
  const envSchema = await Bun.file(
    resolve(import.meta.dir, "../env.schema.ts")
  ).text();
  const helper = await Bun.file(
    resolve(
      import.meta.dir,
      "../shared/testing/workspace-postgres-test-database.test-utils.ts"
    )
  ).text();
  const preload = await Bun.file(
    resolve(import.meta.dir, "../shared/testing/workspace-test-environment.ts")
  ).text();

  expect(envSchema).not.toContain("WORKSPACE_TEST_DATABASE_URL");
  expect(helper).toContain("WORKSPACE_TEST_DATABASE_URL");
  expect(helper).not.toContain("process.env.DATABASE_URL");
  expect(preload).toContain("process.env.WORKSPACE_TEST_DATABASE_URL");
});
