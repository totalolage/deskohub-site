import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  shardTimingsArtifactPattern,
  testTimingsPath,
} from "./refresh-test-timings";
import { runCommand } from "./shared/command";
import { identifierNames, parseTrackedSource } from "./shared/source-ast";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowStep,
  workflowSteps,
} from "./shared/workflow-contract";

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/workspace-tests.yml"
);

const doc = parseWorkflow(workflowPath);
const testJob = doc.jobs["test-functional-shards"];
const shardContract = testJob as typeof testJob & {
  readonly env?: Record<string, string>;
  readonly strategy?: {
    readonly "fail-fast"?: boolean;
    readonly matrix?: { readonly shard?: readonly number[] };
  };
};

const stepByName = (name: string): WorkflowStep => {
  const step = findStepByName(doc, name);
  expect(step).toBeDefined();
  return step as WorkflowStep;
};

// Workflow scripts run in an isolated shell: earlier suites in the same Bun
// process may have mutated process.env, and an inherited environment must not
// be able to change a fail-closed check.
const workflowScriptExitCode = async (
  script: string,
  env: Record<string, string>
) => {
  const result = await runCommand(
    ["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
    { env: { PATH: process.env.PATH ?? "", ...env }, timeoutMs: 5000 }
  );
  // A script that never finishes must not pass as a non-zero exit.
  expect(result.timedOut).toBe(false);
  return result.exitCode;
};

test("fails each shard before its tests when the disposable database is missing", async () => {
  const steps = workflowSteps(doc, "test-functional-shards");
  const guard = stepByName("Require the Workspace test database");
  const testStep = stepByName("Run Workspace tests");
  expect(steps.indexOf(guard)).toBeGreaterThan(-1);
  expect(steps.indexOf(guard)).toBeLessThan(steps.indexOf(testStep));

  // Both steps read the job-level value, so the guard checks what the tests
  // receive.
  expect(shardContract.env?.WORKSPACE_TEST_DATABASE_URL).toBeDefined();
  expect(guard.env?.WORKSPACE_TEST_DATABASE_URL).toBeUndefined();
  expect(testStep.env?.WORKSPACE_TEST_DATABASE_URL).toBeUndefined();

  // The test step reads the disposable database; no repository secrets.
  expect(JSON.stringify(testStep.env ?? {}).includes("secrets.")).toBe(false);

  const guardScript = guard.run ?? "";
  expect(await workflowScriptExitCode(guardScript, {})).not.toBe(0);
  expect(
    await workflowScriptExitCode(guardScript, {
      WORKSPACE_TEST_DATABASE_URL: "",
    })
  ).not.toBe(0);
  expect(
    await workflowScriptExitCode(guardScript, {
      WORKSPACE_TEST_DATABASE_URL:
        "postgresql://synthetic@127.0.0.1:5432/synthetic",
    })
  ).toBe(0);
});

test("balances shards by committed durations and uploads each shard's recording", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")
  ) as { readonly scripts: { readonly test: string } };
  const timingsFile = relative(resolve(import.meta.dir, ".."), testTimingsPath);
  // Every shard reads the same committed file, so the split is deterministic.
  expect(packageJson.scripts.test).toContain(`--timings=./${timingsFile}`);
  expect(stepByName("Run Workspace tests").run).toContain(
    `--timings=${timingsFile} --update-timings`
  );

  const upload = stepByName("Upload Workspace test timings");
  // Only a passing shard's recording is trustworthy for rebalancing.
  expect(upload.if).toBeUndefined();
  expect(upload.with?.path).toBe(`apps/deskohub-workspace/${timingsFile}`);
  const artifactName = String(upload.with?.name);
  expect(
    new Bun.Glob(shardTimingsArtifactPattern).match(
      artifactName.replace("$" + "{{ matrix.shard }}", "1")
    )
  ).toBe(true);
});

test("splits the suite across every matrix shard and keeps test-functional as a fail-closed gate", async () => {
  // A shard count that disagrees with the matrix skips or repeats test files.
  expect(shardContract.strategy?.["fail-fast"]).toBe(false);
  const shards = shardContract.strategy?.matrix?.shard ?? [];
  const shardFlag = stepByName("Run Workspace tests").run?.match(
    /--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/
  );
  expect(shardFlag).not.toBeNull();
  expect(shards).toHaveLength(Number(shardFlag?.[1]));
  expect(shards).toEqual(shards.map((_, index) => index + 1));

  // Suites mutate process-wide state, so each shard runs one test process.
  const packageJson = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")
  ) as { readonly scripts: { readonly test: string } };
  expect(packageJson.scripts.test).toContain("--parallel=1");

  const gate = doc.jobs["test-functional"];
  const gateNeeds = gate.needs as readonly string[];
  expect(gateNeeds).toEqual([
    "validate-workspace",
    "validate-workspace-migrations",
    "test-functional-shards",
    "validate-administration-messages",
  ]);
  expect(gate.if).toContain("always()");

  // Every needed job's result reaches the gate script.
  const gateStep = workflowSteps(doc, "test-functional")[0];
  const gateEnv = gateStep?.env ?? {};
  expect(
    Object.values(gateEnv)
      .map((value) => value.match(/^\$\{\{ needs\.([\w-]+)\.result \}\}$/)?.[1])
      .sort()
  ).toEqual([...gateNeeds].sort());

  const resultNames = Object.keys(gateEnv);
  const successfulResults = Object.fromEntries(
    resultNames.map((resultName) => [resultName, "success"])
  );
  const gateScript = gateStep?.run ?? "";
  expect(await workflowScriptExitCode(gateScript, successfulResults)).toBe(0);
  for (const resultName of resultNames) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(
        await workflowScriptExitCode(gateScript, {
          ...successfulResults,
          [resultName]: result,
        })
      ).not.toBe(0);
    }
  }
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

  expect(
    (turbo.tasks.test?.passThroughEnv ?? []).includes(
      "WORKSPACE_TEST_DATABASE_URL"
    )
  ).toBe(true);
  expect(turbo.tasks.test?.cache).toBe(false);
});

test("keeps the disposable test database out of runtime configuration", () => {
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

  // The preload mirrors the disposable database into the runtime
  // DATABASE_URL whenever it is configured; this process ran it.
  const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;
  if (testDatabaseUrl !== undefined) {
    expect(process.env.DATABASE_URL).toBe(testDatabaseUrl);
  }
});
