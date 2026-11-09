import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import { shardTimingsArtifactPattern } from "./refresh-test-timings";
import { commandOutput, runCommand } from "./shared/command";
import { identifierNames, parseTrackedSource } from "./shared/source-ast";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowStep,
  workflowSteps,
} from "./shared/workflow-contract";
import { createWorkflowStepRunner } from "./shared/workflow-step-runner";
import { shardTimingsRecording, testShardCount } from "./test-shard";

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

const affectedName = "WORKSPACE_SHARDS_AFFECTED";

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

test("runs each matrix shard as its cached Turbo task and uploads the shard's recording", () => {
  // The shard task balances by the committed test-timings.json and records
  // into its own file, which a cache hit restores.
  expect(stepByName("Run Workspace tests").run).toBe(
    "bun --no-env-file turbo run test:shard-$" +
      "{{ matrix.shard }} --filter=./apps/deskohub-workspace"
  );

  const upload = stepByName("Upload Workspace test timings");
  // Only a passing shard's recording is trustworthy for rebalancing.
  expect(upload.if).toBeUndefined();
  expect(
    String(upload.with?.path).replace("$" + "{{ matrix.shard }}", "1")
  ).toBe(`apps/deskohub-workspace/${shardTimingsRecording(1)}`);
  const artifactName = String(upload.with?.name);
  expect(
    new Bun.Glob(shardTimingsArtifactPattern).match(
      artifactName.replace("$" + "{{ matrix.shard }}", "1")
    )
  ).toBe(true);
});

test("checks the shard inputs outside Turbo's cache on every pull request", () => {
  const check = workflowSteps(doc, "validate-workspace").find(
    (step) => step.name === "Check Workspace test shard inputs"
  );
  expect(check?.["working-directory"]).toBe("apps/deskohub-workspace");
  expect(check?.run).toBe("bun test scripts/test-shard.test.ts");
});

test("runs Mobile's tests and the repository-wide tests in Workspace validation, which the gate always needs", () => {
  // The shards depend on neither, so a skipped shard matrix must not skip them.
  const steps = workflowSteps(doc, "validate-workspace");
  for (const name of ["Run repository-wide tests", "Test Mobile"]) {
    const step = steps.find((candidate) => candidate.name === name);
    expect(step).toBeDefined();
    expect(step?.if).toBeUndefined();
    expect(step?.["continue-on-error"]).toBeUndefined();
  }
  expect(steps.find((step) => step.name === "Test Mobile")?.run).toBe(
    "bun turbo run test --filter=deskohub-mobile"
  );
  expect(doc.jobs["test-functional"]?.needs).toContain("validate-workspace");
});

describe("repository-wide test step", () => {
  const step = stepByName("Run repository-wide tests");
  const runner = createWorkflowStepRunner("workspace-repository-tests-");
  const repositories = mkdtempSync(join(tmpdir(), "workspace-repository-"));
  const files = [
    "a/x.repository-wide.test.ts",
    "b/c/y.repository-wide.test.tsx",
  ];

  beforeAll(async () => {
    for (const repository of ["with-tests", "without-tests"]) {
      await commandOutput(["git", "init", "--quiet", repository], {
        cwd: repositories,
      });
    }
    const withTests = join(repositories, "with-tests");
    for (const file of [...files, "a/z.test.ts", "a/w.repository.test.ts"]) {
      await Bun.write(join(withTests, file), "");
    }
    await commandOutput(["git", "add", "."], { cwd: withTests });
  });

  afterAll(() => {
    runner.cleanup();
    rmSync(repositories, { force: true, recursive: true });
  });

  // Stands in for bun: logs its arguments and exits as told.
  const fakeBun = (exitCode: number) => `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_FIXTURES/calls.log"
exit ${exitCode}
`;

  const runTests = (repository: string, exitCode = 0) =>
    runner.runStep(
      step,
      {},
      { GIT_DIR: join(repositories, repository, ".git") },
      { bun: fakeBun(exitCode) }
    );

  test("runs every tracked repository-wide test by path", async () => {
    const { calls, result } = await runTests("with-tests");
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([
      `test ${files.map((file) => `./${file}`).join(" ")}`,
    ]);
  });

  test("fails when a repository-wide test fails", async () => {
    const { result } = await runTests("with-tests", 1);
    expect(result.exitCode).not.toBe(0);
  });

  test("fails without running bun when it finds no repository-wide test", async () => {
    const { calls, result } = await runTests("without-tests");
    expect(result.exitCode).not.toBe(0);
    expect(calls).toEqual([]);
  });

  test("fails without running bun when listing the tests fails partway", async () => {
    // A listing that fails after printing some paths must not pass on them.
    const { calls, result } = await runner.runStep(
      step,
      {},
      {},
      {
        bun: fakeBun(0),
        git: `#!/usr/bin/env bash
printf '%s\\n' ${files[0]}
exit 1
`,
      }
    );
    expect(result.exitCode).not.toBe(0);
    expect(calls).toEqual([]);
  });
});

test("runs the shards with the Bun the repository pins", () => {
  const rootPackage = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../../package.json"), "utf8")
  ) as { readonly packageManager: string };
  const setupBun = workflowSteps(doc, "test-functional-shards").find((step) =>
    step.uses?.startsWith("oven-sh/setup-bun@")
  );
  expect(`bun@${setupBun?.with?.["bun-version"]}`).toBe(
    rootPackage.packageManager
  );
});

test("splits the suite across every matrix shard and keeps test-functional as a fail-closed gate", async () => {
  // A shard count that disagrees with the matrix skips or repeats test files.
  expect(shardContract.strategy?.["fail-fast"]).toBe(false);
  const shards = shardContract.strategy?.matrix?.shard ?? [];
  expect(shards).toHaveLength(testShardCount);
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
    "select-workspace-shards",
    "test-functional-shards",
    "validate-administration-messages",
  ]);
  expect(gate.if).toContain("always()");

  // Every needed job's result, and the selection's verdict, reach the gate
  // script.
  const gateStep = workflowSteps(doc, "test-functional")[0];
  const { [affectedName]: affectedValue, ...resultEnv } = gateStep?.env ?? {};
  expect(affectedValue).toBe(
    "$" + "{{ needs.select-workspace-shards.outputs.affected }}"
  );
  const resultJobs = Object.fromEntries(
    Object.entries(resultEnv).map(([name, value]) => [
      name,
      value.match(/^\$\{\{ needs\.([\w-]+)\.result \}\}$/)?.[1],
    ])
  );
  expect(Object.values(resultJobs).sort()).toEqual([...gateNeeds].sort());
  const shardsResultName = Object.keys(resultJobs).find(
    (name) => resultJobs[name] === "test-functional-shards"
  ) as string;

  const successfulResults = Object.fromEntries(
    Object.keys(resultEnv).map((resultName) => [resultName, "success"])
  );
  const gateScript = gateStep?.run ?? "";
  // A missing job output renders as the empty string.
  const gateExitCode = (affected: string, results: Record<string, string>) =>
    workflowScriptExitCode(gateScript, {
      ...successfulResults,
      ...results,
      [affectedName]: affected,
    });

  // The shards pass only by running when affected, or by being skipped when
  // not; a missing or unexpected verdict never passes.
  for (const affected of ["true", "false", "", "yes"]) {
    for (const result of ["success", "failure", "cancelled", "skipped"]) {
      const passes =
        (affected === "true" && result === "success") ||
        (affected === "false" && result === "skipped");
      expect(await gateExitCode(affected, { [shardsResultName]: result })).toBe(
        passes ? 0 : 1
      );
    }
  }

  // Every other job, the selection included, must succeed either way.
  for (const resultName of Object.keys(resultEnv)) {
    if (resultName === shardsResultName) {
      continue;
    }
    for (const result of ["failure", "cancelled", "skipped"]) {
      for (const [affected, shards] of [
        ["true", "success"],
        ["false", "skipped"],
      ] as const) {
        expect(
          await gateExitCode(affected, {
            [shardsResultName]: shards,
            [resultName]: result,
          })
        ).not.toBe(0);
      }
    }
  }
});

test("runs the shards only when the selection finds an affected shard task", () => {
  const selectJob = doc.jobs["select-workspace-shards"];
  const select = stepByName("Select the affected Workspace test shards");
  expect(selectJob.outputs?.affected).toBe(
    `\${{ steps.${select.id}.outputs.affected }}`
  );
  expect(selectJob.if).toBe(testJob.if?.split(" &&")[0]);

  // A skipped needed job skips its dependents, so a failed selection can
  // never run (or pass) the shards.
  expect(testJob.needs).toBe("select-workspace-shards");
  expect(testJob.if).toBe(
    "github.event.action != 'converted_to_draft' && " +
      "needs.select-workspace-shards.outputs.affected == 'true'"
  );

  // The merge commit's first parent must be in the checkout.
  const checkout = workflowSteps(doc, "select-workspace-shards").find((step) =>
    step.uses?.startsWith("actions/checkout@")
  );
  expect(Number(checkout?.with?.["fetch-depth"])).toBeGreaterThanOrEqual(2);

  // The selection asks about every shard task, with the Turbo the lockfile
  // installs, and matches changes against task inputs.
  const installedTurbo = JSON.parse(
    readFileSync(
      resolve(import.meta.dir, "../../../node_modules/turbo/package.json"),
      "utf8"
    )
  ) as { readonly version: string };
  expect(select.run).toContain(`bunx turbo@${installedTurbo.version} run`);
  const shardTasks = Array.from(
    { length: testShardCount },
    (_, index) => `test:shard-${index + 1}`
  );
  expect(select.run).toContain(` ${shardTasks.join(" ")} `);
  const rootTurbo = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../../turbo.json"), "utf8")
  ) as {
    readonly futureFlags?: { readonly affectedUsingTaskInputs?: boolean };
  };
  expect(rootTurbo.futureFlags?.affectedUsingTaskInputs).toBe(true);
});

describe("shard selection step", () => {
  const select = stepByName("Select the affected Workspace test shards");
  const runner = createWorkflowStepRunner("workspace-shard-selection-");
  const repositories = mkdtempSync(join(tmpdir(), "workspace-shard-repo-"));
  const git = (repository: string, ...args: string[]) =>
    commandOutput(
      [
        "git",
        "-c",
        "user.name=CI",
        "-c",
        `user.email=${testEmailAddress("ci")}`,
        ...args,
      ],
      { cwd: join(repositories, repository) }
    ).then((output) => output.trim());
  let base = "";
  let merge = "";
  let linear = "";

  beforeAll(async () => {
    // A pull request's merge commit, and a checkout that is not one.
    for (const repository of ["merge", "linear"]) {
      await commandOutput(["git", "init", "--quiet", repository], {
        cwd: repositories,
      });
      await git(repository, "commit", "--quiet", "--allow-empty", "-m", "base");
    }
    base = await git("merge", "rev-parse", "HEAD");
    await git("merge", "switch", "--quiet", "-c", "change");
    await git("merge", "commit", "--quiet", "--allow-empty", "-m", "change");
    await git("merge", "switch", "--quiet", "-");
    await git("merge", "merge", "--quiet", "--no-ff", "-m", "merge", "change");
    merge = await git("merge", "rev-parse", "HEAD");
    // A parent to compare with, but no merge.
    await git("linear", "commit", "--quiet", "--allow-empty", "-m", "change");
    linear = await git("linear", "rev-parse", "HEAD");
  });

  afterAll(() => {
    runner.cleanup();
    rmSync(repositories, { force: true, recursive: true });
  });

  // Stands in for bunx: logs the range and arguments Turbo would get and
  // prints the given dry run.
  const fakeBunx = (dryRun: string, exitCode = 0) => `#!/usr/bin/env bash
printf '%s %s %s\\n' "$TURBO_SCM_BASE" "$TURBO_SCM_HEAD" "$*" >> "$GH_FIXTURES/calls.log"
cat <<'DRY_RUN'
${dryRun}
DRY_RUN
exit ${exitCode}
`;

  const runSelection = (
    dryRun: string,
    { exitCode = 0, repository = "merge", head = merge } = {}
  ) =>
    runner.runStep(
      select,
      {},
      {
        GIT_DIR: join(repositories, repository, ".git"),
        GITHUB_SHA: head,
      },
      { bunx: fakeBunx(dryRun, exitCode) }
    );

  const dryRunOf = (taskIds: readonly string[]) =>
    JSON.stringify({ tasks: taskIds.map((taskId) => ({ taskId })) });

  test("compares the merge commit with its first parent", async () => {
    const { calls, outputs, result } = await runSelection(dryRunOf([]));
    expect(result.exitCode).toBe(0);
    expect(outputs.affected).toBe("false");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith(`${base} HEAD turbo@`);
    expect(calls[0]).toEndWith(" --affected --dry-run=json");
  });

  test("reports the shards affected when the dry run selects a shard task", async () => {
    const { outputs, result } = await runSelection(
      dryRunOf([
        "@deskohub/i18n#test",
        `deskohub-workspace#test:shard-${testShardCount}`,
      ])
    );
    expect(result.exitCode).toBe(0);
    expect(outputs.affected).toBe("true");
  });

  test("reports the shards unaffected when only other tasks are selected", async () => {
    const { outputs, result } = await runSelection(
      dryRunOf(["@deskohub/i18n#test"])
    );
    expect(result.exitCode).toBe(0);
    expect(outputs.affected).toBe("false");
  });

  test("fails without a verdict when the selection cannot be trusted", async () => {
    const untrusted = [
      runSelection(dryRunOf([]), { exitCode: 1 }),
      runSelection("not json"),
      runSelection("{}"),
      runSelection(JSON.stringify({ tasks: {} })),
      runSelection(JSON.stringify({ tasks: [{ task: "test:shard-1" }] })),
      runSelection(
        `${dryRunOf([])}\n${dryRunOf(["deskohub-workspace#test:shard-1"])}`
      ),
      // Not the commit the run is for, or not a merge commit.
      runSelection(dryRunOf([]), { head: base }),
      runSelection(dryRunOf([]), { repository: "linear", head: linear }),
    ];
    for (const { outputs, result } of await Promise.all(untrusted)) {
      expect(result.exitCode).not.toBe(0);
      expect(outputs.affected).toBeUndefined();
    }
  });
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
