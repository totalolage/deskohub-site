import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reviewScreenshotsEnabled } from "../e2e/e2e-env";
import { makeTestE2EEnvironment } from "../e2e/e2e-env.test-fixture";
import { workspaceE2ENonPaymentCaseIds } from "../e2e/playwright-checkout/case-catalog";
import { runCommand } from "./shared/command";
import {
  evaluateWorkflowValue,
  findStepByName,
  parseWorkflow,
  type WorkflowExpressionContext,
  type WorkflowStep,
  workflowExpressionBoolean,
  workflowExpressionString,
  workflowStepNames,
} from "./shared/workflow-contract";

type PlaywrightCheckoutConfig =
  typeof import("../playwright.e2e.config")["default"];

type PlaywrightInstantNavigationConfig =
  typeof import("../playwright.instant-navigation.config")["default"];

// The real Playwright configs are executed (not text-scanned) and their
// resolved structure is asserted on. They run in a child process because the
// configs resolve their browser executable with a top-level await, which
// bun's test runner does not settle reliably across multiple entry files.
const loadPlaywrightConfigStructure = async <Config>(
  configModule: string
): Promise<Config> => {
  const result = await runCommand(
    [
      process.execPath,
      "-e",
      `const config = (await import(${JSON.stringify(configModule)})).default; console.log(JSON.stringify(config));`,
    ],
    { cwd: resolve(import.meta.dir, ".."), timeoutMs: 15_000 }
  );
  if (result.timedOut) {
    throw new Error("actual Playwright config loader timed out");
  }
  if (result.signalCode !== null) {
    throw new Error("actual Playwright config loader was interrupted");
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `actual Playwright config loader exited with status ${result.exitCode}`
    );
  }
  try {
    return JSON.parse(result.stdout) as Config;
  } catch {
    throw new Error("actual Playwright config loader emitted invalid JSON");
  }
};

let cachedConfigStructure: Promise<PlaywrightCheckoutConfig> | undefined;
const playwrightConfigStructure = (): Promise<PlaywrightCheckoutConfig> => {
  cachedConfigStructure ??= loadPlaywrightConfigStructure(
    "./playwright.e2e.config"
  );
  return cachedConfigStructure;
};

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/workspace-e2e.yml"
);
const doc = parseWorkflow(workflowPath);
const productionWorkflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/deploy-workspace-production.yml"
);

const productionDoc = parseWorkflow(productionWorkflowPath);
const workflowDispatchInputs = doc.on?.workflow_dispatch?.inputs;
// Format-insensitive view of the parsed workflow used for document-level
// token presence/absence checks; assertions never touch raw file text.
const serializedWorkflow = JSON.stringify(doc);
const serializedProductionWorkflow = JSON.stringify(productionDoc);
const stepNames = workflowStepNames(doc);
const allSteps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
const testJob = doc.jobs["test-e2e"];

const stepByName = (name: string): WorkflowStep => {
  const step = findStepByName(doc, name);
  expect(step).toBeDefined();
  return step as WorkflowStep;
};

const stepsBetweenNames = (
  fromName: string,
  toName?: string
): readonly WorkflowStep[] => {
  const from = allSteps.findIndex((step) => step.name === fromName);
  const to =
    toName === undefined
      ? allSteps.length
      : allSteps.findIndex((step) => step.name === toName);
  expect(from).toBeGreaterThanOrEqual(0);
  return allSteps.slice(from, to);
};

const readTrackedJson = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(import.meta.dir, path), "utf8")) as T;

type TurboConfig = {
  readonly globalEnv?: readonly string[];
  readonly globalPassThroughEnv?: readonly string[];
  readonly tasks?: Readonly<
    Record<
      string,
      {
        readonly env?: readonly string[];
        readonly passThroughEnv?: readonly string[];
      }
    >
  >;
};

const turboEnvEntryMatches = (entry: string, name: string) =>
  entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : entry === name;

/**
 * Every Turborepo env list, global or per task, that would hand the named
 * variable to a task, including wildcard entries.
 */
const turboSecretExposures = (
  configs: Readonly<Record<string, TurboConfig>>,
  name: string
) =>
  Object.entries(configs).flatMap(([label, turbo]) => {
    const lists: [string, readonly string[] | undefined][] = [
      ["globalEnv", turbo.globalEnv],
      ["globalPassThroughEnv", turbo.globalPassThroughEnv],
      ...Object.entries(turbo.tasks ?? {}).flatMap(
        ([task, definition]): [string, readonly string[] | undefined][] => [
          [`tasks.${task}.env`, definition.env],
          [`tasks.${task}.passThroughEnv`, definition.passThroughEnv],
        ]
      ),
    ];
    return lists
      .filter(([, entries]) =>
        (entries ?? []).some((entry) => turboEnvEntryMatches(entry, name))
      )
      .map(([path]) => `${label} ${path}`);
  });

const trackedTurboExposures = (name: string) =>
  turboSecretExposures(
    {
      app: readTrackedJson<TurboConfig>("../turbo.json"),
      root: readTrackedJson<TurboConfig>("../../../turbo.json"),
    },
    name
  );

const projectByName = (config: PlaywrightCheckoutConfig, name: string) =>
  config.projects.find((project) => project.name === name);

// Checkout case projects.
const checkoutCaseProjectNames = ["checkout-cases"];

// The screenshot opt-ins read only these contexts; any other path throws.
const screenshotOptInContexts = ["github", "inputs"];

const repositoryDispatchContext = (): WorkflowExpressionContext => ({
  contexts: screenshotOptInContexts,
  values: new Map([
    ["github.event_name", workflowExpressionString("repository_dispatch")],
  ]),
});

// A manual dispatch fills omitted inputs from their declared defaults and
// passes boolean inputs as booleans.
const workflowDispatchContext = (
  inputs: Readonly<Record<string, boolean>>
): WorkflowExpressionContext => {
  const values = new Map([
    ["github.event_name", workflowExpressionString("workflow_dispatch")],
  ]);
  for (const [name, input] of Object.entries(workflowDispatchInputs ?? {})) {
    if (input.default !== undefined) {
      values.set(
        `inputs.${name}`,
        input.type === "boolean"
          ? workflowExpressionBoolean(String(input.default) === "true")
          : workflowExpressionString(String(input.default))
      );
    }
  }
  for (const [name, value] of Object.entries(inputs)) {
    values.set(`inputs.${name}`, workflowExpressionBoolean(value));
  }
  return { contexts: screenshotOptInContexts, values };
};

describe("workspace E2E workflow", () => {
  test("keeps the atomic allocator isolated from exact-SHA test code", () => {
    const tokenCheckouts = allSteps.filter((step) =>
      (step.uses ?? "").startsWith("actions/checkout")
    );
    expect(tokenCheckouts.length).toBeGreaterThan(0);
    for (const checkout of tokenCheckouts) {
      expect(checkout.with?.["persist-credentials"]).toBe(false);
    }

    // The coordinator database credential reaches the allocation action only.
    const coordinatorSecretSteps = allSteps.filter((step) =>
      JSON.stringify(step).includes(
        "secrets.WORKSPACE_E2E_COORDINATOR_DATABASE_URL"
      )
    );
    expect(coordinatorSecretSteps.length).toBeGreaterThan(0);
    for (const step of coordinatorSecretSteps) {
      expect(step.uses).toEndWith("/.github/actions/workspace-e2e-allocation");
    }

    const staleCleanup = JSON.stringify(
      stepsBetweenNames(
        "Reconcile stale Workspace E2E reservations",
        "Validate aggregate Dotypos capacity"
      )
    );
    expect(
      staleCleanup.includes("secrets.WORKSPACE_E2E_DOTYPOS_CLIENT_SECRET")
    ).toBe(true);
    expect(staleCleanup.includes("secrets.DOTYPOS_CLIENT_SECRET")).toBe(false);
    expect(
      staleCleanup.includes("WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL")
    ).toBe(false);
    expect(
      staleCleanup.includes("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED")
    ).toBe(false);

    const capacity = JSON.stringify(
      stepsBetweenNames(
        "Validate aggregate Dotypos capacity",
        "Verify hosted browser runtime"
      )
    );
    expect(
      capacity.includes("WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL")
    ).toBe(false);
    expect(capacity.includes("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED")).toBe(
      false
    );
  });

  test("grants each job only the token permissions it needs", () => {
    // Target resolution inherits the read-only default: it reads deployments
    // and their statuses to bind the exact-SHA preview, and the eligible PR.
    expect(doc.permissions).toEqual({
      contents: "read",
      deployments: "read",
      "pull-requests": "read",
      statuses: "read",
    });
    // Only the jobs that publish commit statuses opt into write access. A job
    // left undefined here must inherit the read-only default.
    expect(
      Object.fromEntries(
        Object.entries(doc.jobs).map(([name, job]) => [name, job.permissions])
      )
    ).toEqual({
      "resolve-target": undefined,
      "test-e2e": {
        actions: "read",
        contents: "read",
        "pull-requests": "read",
        statuses: "write",
      },
      // Cancels only its own run, and runs no exact-SHA code.
      "cancel-superseded-run": { actions: "write", "pull-requests": "read" },
      "publish-final-status": {
        contents: "read",
        "pull-requests": "read",
        statuses: "write",
      },
      "publish-status-without-run": { contents: "read", statuses: "write" },
    });
  });

  test("migrates the resolved preview before capacity checks and browser setup", () => {
    const steps = testJob.steps ?? [];
    const resolveIndex = steps.findIndex(
      (step) => step.name === "Resolve Neon branch backing the preview"
    );
    const migrateIndex = steps.findIndex(
      (step) => step.name === "Migrate preview database"
    );
    const staleCleanupIndex = steps.findIndex(
      (step) => step.name === "Reconcile stale Workspace E2E reservations"
    );
    const capacityIndex = steps.findIndex(
      (step) => step.name === "Validate aggregate Dotypos capacity"
    );
    const browserIndex = steps.findIndex(
      (step) => step.name === "Verify hosted browser runtime"
    );
    const migration = stepByName("Migrate preview database");
    const runIndex = steps.findIndex(
      (step) => step.name === "Run checkout E2E"
    );

    expect(testJob.needs).toBe("resolve-target");
    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(migrateIndex).toBeGreaterThan(resolveIndex);
    expect(staleCleanupIndex).toBeGreaterThan(migrateIndex);
    expect(capacityIndex).toBeGreaterThan(migrateIndex);
    expect(browserIndex).toBeGreaterThan(migrateIndex);
    expect(runIndex).toBeGreaterThan(migrateIndex);
    // A failed migration must stop the run instead of testing a stale schema.
    expect(migration.if).toBeUndefined();
    expect(migration["continue-on-error"]).toBeUndefined();
  });

  test("classifies the synthetic main account only after a failed E2E run", () => {
    const uploadIndex = allSteps.findIndex((step) =>
      (step.uses ?? "").startsWith("actions/upload-artifact@")
    );
    const diagnosticIndex = allSteps.findIndex(
      (step) => step.name === "Classify synthetic main account state"
    );
    const releaseIndex = allSteps.findIndex(
      (step) => step.name === "Release date shard"
    );
    expect(diagnosticIndex).toBeGreaterThan(uploadIndex);
    expect(diagnosticIndex).toBeLessThan(releaseIndex);

    const diagnostic = stepByName("Classify synthetic main account state");
    const diagnosticEnv = JSON.stringify(diagnostic.env);
    expect(diagnostic.if).toBe("failure()");
    expect(diagnostic["continue-on-error"]).toBe(true);
    expect(diagnosticEnv.includes("WORKSPACE_E2E_RESEND_API_KEY")).toBe(false);
    expect(diagnosticEnv.includes("WORKSPACE_E2E_PROVIDER_PERMIT")).toBe(false);
    expect(
      diagnosticEnv.includes("WORKSPACE_E2E_COORDINATOR_DATABASE_URL")
    ).toBe(false);
  });

  test("cancels E2E only for a duplicate run of the same SHA", () => {
    // A late event for an older head or a skip resolves ineligible or never
    // reaches the E2E job, so cancellation lives on that job alone, after
    // eligibility, and runs for different SHAs never share its group. Assert
    // on parsed objects so a workflow-level group or a cancelling group on
    // another job is caught however it is spelled.
    expect(doc.concurrency).toBeUndefined();
    expect(testJob.if).toContain(
      "needs.resolve-target.outputs.eligible == 'true'"
    );
    expect(testJob.if).toContain(
      "needs.resolve-target.outputs.deployment == 'success'"
    );
    const testConcurrency = testJob.concurrency;
    expect(testConcurrency?.["cancel-in-progress"]).toBe(true);
    expect(testConcurrency?.group).toStartWith("workspace-e2e-pr-");
    expect(testConcurrency?.group).toContain(
      "needs.resolve-target.outputs.pr_number"
    );
    expect(testConcurrency?.group).toContain(
      "needs.resolve-target.outputs.sha"
    );
    for (const [name, job] of Object.entries(doc.jobs)) {
      if (name !== "test-e2e") {
        expect(job.concurrency).toBeUndefined();
      }
    }
  });

  test("uses the allocator without a global provider lock", () => {
    // The only E2E concurrency group is per PR, never across PRs.
    expect(JSON.stringify(testJob.concurrency)).toContain(
      "needs.resolve-target.outputs.pr_number"
    );

    const targetCheckoutIndex = stepNames.indexOf("Checkout exact target");
    const coordinatorCheckoutIndex = stepNames.indexOf(
      "Checkout allocation action"
    );
    const leaseIndex = stepNames.indexOf("Lease an available date shard");
    const runIndex = stepNames.indexOf("Run checkout E2E");
    const releaseIndex = stepNames.indexOf("Release date shard");

    expect(targetCheckoutIndex).toBeLessThan(coordinatorCheckoutIndex);
    expect(coordinatorCheckoutIndex).toBeLessThan(leaseIndex);
    expect(leaseIndex).toBeLessThan(runIndex);
    expect(runIndex).toBeLessThan(releaseIndex);
  });

  test("passes allocated shard and provider coordination through Turborepo", () => {
    const turbo = readTrackedJson("../../../turbo.json") as {
      readonly tasks: {
        readonly "test:e2e": { readonly passThroughEnv: string[] };
      };
    };
    const environment = turbo.tasks["test:e2e"].passThroughEnv;

    expect(environment).toContain("WORKSPACE_E2E_ALLOCATION_SHARD");
    expect(environment).toContain("GITHUB_STEP_SUMMARY");
    expect(environment).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
    expect(environment).toContain("WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL");
    expect(environment).toContain("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED");
    expect(environment).toContain("WORKSPACE_E2E_VERCEL_TOKEN");
    expect(environment).toContain("WORKSPACE_E2E_VERCEL_PROJECT");
    expect(environment).toContain("WORKSPACE_E2E_BETTER_AUTH_SECRETS");
    expect(environment).toContain("WORKSPACE_E2E_REVIEW_SCREENSHOTS");
    expect(environment).toContain("WORKSPACE_E2E_CAMPAIGN_REVIEW_SCREENSHOTS");
    expect(environment).not.toContain("WORKSPACE_E2E_RESEND_API_KEY");
  });

  test("declares both screenshot opt-ins as optional, off-by-default flags", () => {
    for (const input of ["review_screenshots", "campaign_screenshots"]) {
      expect(workflowDispatchInputs?.[input]).toMatchObject({
        required: false,
        default: false,
        type: "boolean",
      });
    }
  });

  test.each([
    {
      event: "a Vercel deployment dispatch",
      context: repositoryDispatchContext(),
      review: false,
      campaign: false,
    },
    {
      event: "a manual dispatch with default inputs",
      context: workflowDispatchContext({}),
      review: false,
      campaign: false,
    },
    {
      event: "a manual dispatch asking for review screenshots",
      context: workflowDispatchContext({ review_screenshots: true }),
      review: true,
      campaign: false,
    },
    {
      event: "a manual dispatch asking for campaign screenshots",
      context: workflowDispatchContext({ campaign_screenshots: true }),
      review: false,
      campaign: true,
    },
    {
      event: "a manual dispatch asking for both",
      context: workflowDispatchContext({
        campaign_screenshots: true,
        review_screenshots: true,
      }),
      review: true,
      campaign: true,
    },
  ])(
    "captures only the requested screenshots for $event",
    ({ context, review, campaign }) => {
      const stepEnvironment = stepByName("Run checkout E2E").env ?? {};
      const environment = makeTestE2EEnvironment(
        Object.fromEntries(
          [
            "WORKSPACE_E2E_REVIEW_SCREENSHOTS",
            "WORKSPACE_E2E_CAMPAIGN_REVIEW_SCREENSHOTS",
          ].map((name) => {
            const value = stepEnvironment[name];
            expect(value).toBeDefined();
            return [name, evaluateWorkflowValue(value as string, context)];
          })
        )
      );

      expect(reviewScreenshotsEnabled(environment)).toBe(review);
      expect(
        environment.WORKSPACE_E2E_CAMPAIGN_REVIEW_SCREENSHOTS === "true"
      ).toBe(campaign);
    }
  );

  test("generates the Igloohome client before Workspace E2E startup", async () => {
    const result = await runCommand(
      [
        process.execPath,
        "turbo",
        "run",
        "test:e2e",
        "--filter=deskohub-workspace",
        "--dry=json",
      ],
      {
        cwd: resolve(import.meta.dir, "../../../"),
        env: { ...process.env, TURBO_UI: "false" },
      }
    );

    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    const jsonStart = output.indexOf("{");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const graph = JSON.parse(output.slice(jsonStart)) as {
      readonly tasks: readonly {
        readonly dependencies: readonly string[];
        readonly resolvedTaskDefinition: {
          readonly dependsOn: readonly string[];
          readonly passThroughEnv: readonly string[];
        };
        readonly taskId: string;
      }[];
    };
    const rootTurbo = readTrackedJson("../../../turbo.json") as {
      readonly tasks: {
        readonly "test:e2e": { readonly passThroughEnv: readonly string[] };
      };
    };
    const e2eTask = graph.tasks.find(
      (task) => task.taskId === "deskohub-workspace#test:e2e"
    );

    expect(e2eTask).toBeDefined();
    expect(e2eTask?.dependencies).toEqual(
      expect.arrayContaining([
        "@deskohub/igloohome#generate",
        "deskohub-workspace#i18n:compile",
      ])
    );
    expect(e2eTask?.resolvedTaskDefinition.dependsOn).toEqual(
      expect.arrayContaining(["@deskohub/igloohome#generate", "i18n:compile"])
    );
    expect(
      [...(e2eTask?.resolvedTaskDefinition.passThroughEnv ?? [])].sort()
    ).toEqual([...rootTurbo.tasks["test:e2e"].passThroughEnv].sort());
  });

  test("keeps the Vercel log-read secret inside the account Playwright execution only", () => {
    expect(stepByName("Run checkout E2E").env?.WORKSPACE_E2E_VERCEL_TOKEN).toBe(
      `\${{ secrets.WORKSPACE_E2E_VERCEL_TOKEN }}`
    );

    // Only the Playwright checkout step holds it, in its env and its own
    // script's nightly preview check.
    const withoutCheckoutStep = JSON.stringify(
      Object.values(doc.jobs).map((job) => ({
        ...job,
        steps: job.steps?.filter((step) => step.name !== "Run checkout E2E"),
      }))
    );
    expect(withoutCheckoutStep).not.toContain("WORKSPACE_E2E_VERCEL_TOKEN");
    expect(serializedWorkflow).toContain("WORKSPACE_E2E_VERCEL_TOKEN");

    expect(serializedWorkflow.includes("WORKSPACE_E2E_RESEND_API_KEY")).toBe(
      false
    );
    expect(serializedWorkflow.includes("secrets.RESEND_API_KEY")).toBe(false);
    expect(
      serializedProductionWorkflow.includes("WORKSPACE_E2E_VERCEL_TOKEN")
    ).toBe(false);
    expect(
      serializedProductionWorkflow.includes("WORKSPACE_E2E_RESEND_API_KEY")
    ).toBe(false);
    expect(serializedProductionWorkflow.includes("EMAIL_API_KEY")).toBe(false);
    expect(serializedProductionWorkflow.includes("BETTER_AUTH")).toBe(false);

    expect(trackedTurboExposures("WORKSPACE_E2E_VERCEL_TOKEN")).toEqual([
      "root tasks.test:e2e.passThroughEnv",
    ]);
    expect(trackedTurboExposures("WORKSPACE_E2E_RESEND_API_KEY")).toEqual([]);
  });

  test("keeps the preview session-signing secret inside the checkout Playwright execution only", () => {
    expect(
      stepByName("Run checkout E2E").env?.WORKSPACE_E2E_BETTER_AUTH_SECRETS
    ).toBe(`\${{ secrets.WORKSPACE_E2E_BETTER_AUTH_SECRETS }}`);
    expect(
      serializedWorkflow.split("WORKSPACE_E2E_BETTER_AUTH_SECRETS").length - 1
    ).toBe(2);
    expect(serializedProductionWorkflow.includes("BETTER_AUTH")).toBe(false);

    expect(trackedTurboExposures("WORKSPACE_E2E_BETTER_AUTH_SECRETS")).toEqual([
      "root tasks.test:e2e.passThroughEnv",
    ]);
  });

  test("the Turborepo secret guard finds global and wildcard exposures", () => {
    const root = readTrackedJson<TurboConfig>("../../../turbo.json");
    const secret = "WORKSPACE_E2E_BETTER_AUTH_SECRETS";
    const injected = (mutate: (turbo: TurboConfig) => TurboConfig) =>
      turboSecretExposures({ root: mutate(structuredClone(root)) }, secret);

    expect(
      injected((turbo) => ({
        ...turbo,
        globalPassThroughEnv: [...(turbo.globalPassThroughEnv ?? []), secret],
      }))
    ).toContain("root globalPassThroughEnv");
    expect(
      injected((turbo) => ({
        ...turbo,
        globalEnv: [...(turbo.globalEnv ?? []), "WORKSPACE_E2E_*"],
      }))
    ).toContain("root globalEnv");
    expect(
      injected((turbo) => ({
        ...turbo,
        tasks: {
          ...turbo.tasks,
          test: { ...turbo.tasks?.test, passThroughEnv: [secret] },
        },
      }))
    ).toContain("root tasks.test.passThroughEnv");
  });

  test("lets Playwright own checkout preparation, scheduling, and parallelism", async () => {
    const playwrightConfig = await playwrightConfigStructure();

    expect(projectByName(playwrightConfig, "checkout-setup")?.teardown).toBe(
      "checkout-cleanup"
    );
    // Preparation is one project, so the case phase waits on one barrier.
    const casePhaseProjects = [
      "account-auth",
      "email-campaign-recipient-preview",
      "access-code-creation",
      ...checkoutCaseProjectNames,
    ];
    for (const name of casePhaseProjects) {
      expect(projectByName(playwrightConfig, name)?.dependencies).toEqual([
        "checkout-setup",
      ]);
    }
    // Queued after every other case-phase project, the access-code case only
    // takes a worker that frees up during the case phase.
    const projectNames = playwrightConfig.projects.map(({ name }) => name);
    for (const name of casePhaseProjects) {
      expect(projectNames.indexOf(name)).toBeLessThanOrEqual(
        projectNames.indexOf("access-code-creation")
      );
    }
  });

  test("leaves the account lane a worker beside the parallel case pool", async () => {
    const playwrightConfig = await playwrightConfigStructure();
    const casePool = projectByName(playwrightConfig, "checkout-cases");

    // Paid cases share the pool; the hosted-payment permit bounds Nexi.
    expect(
      playwrightConfig.projects.filter((project) =>
        project.name?.startsWith("checkout-payment")
      )
    ).toEqual([]);
    expect(casePool?.workers).toBe((playwrightConfig.workers as number) - 1);
    expect(
      projectByName(playwrightConfig, "account-auth")?.dependencies
    ).toEqual(casePool?.dependencies);
  });

  test("runs the Calendar pricing-change case in the case phase without a tail project", async () => {
    const playwrightConfig = await playwrightConfigStructure();

    // The case only mutates the reserved-desk Calendar target, which no other
    // case books, so it no longer needs a project after the case phase.
    expect(
      projectByName(playwrightConfig, "checkout-shared-fixture")
    ).toBeUndefined();
    expect(workspaceE2ENonPaymentCaseIds).toContain(
      "calendar-sale-pricing-changes"
    );
  });

  test("runs read-only navigation beside the checkout graph without gating it", async () => {
    const playwrightConfig = await playwrightConfigStructure();
    const instantNavigationConfig =
      await loadPlaywrightConfigStructure<PlaywrightInstantNavigationConfig>(
        "./playwright.instant-navigation.config"
      );
    expect(doc.jobs["publish-final-status"].needs).toEqual([
      "resolve-target",
      "test-e2e",
    ]);
    // A target E2E never ran against gets no final status.
    expect(doc.jobs["publish-final-status"].if).toContain(
      "needs.resolve-target.outputs.deployment == 'success'"
    );
    // As a checkout project it extended the setup phase barrier, so no
    // checkout project may run the read-only navigation tests.
    const configDir = resolve(import.meta.dir, "..");
    const instantNavigationDir = resolve(
      configDir,
      instantNavigationConfig.testDir ?? ""
    );
    expect(
      playwrightConfig.projects
        .filter(
          (project) =>
            project.name === "instant-navigation" ||
            (project.testDir !== undefined &&
              resolve(configDir, project.testDir) === instantNavigationDir)
        )
        .map((project) => project.name)
    ).toEqual([]);
    // Concurrent invocations must not clobber each other's artifacts.
    expect(instantNavigationConfig.outputDir).not.toBe(
      playwrightConfig.outputDir
    );
  });

  test("restores Bun packages from a workflow-scoped cache saved before test code runs", () => {
    const restore = stepByName("Restore Bun package cache");
    const fill = stepByName("Fill Bun package cache from install manifests");
    const save = stepByName("Save Bun package cache");
    expect(restore.uses).toStartWith("actions/cache/restore@");
    expect(save.uses).toStartWith("actions/cache/save@");
    expect(restore.with?.["restore-keys"]).toBeUndefined();
    expect(String(restore.with?.key)).toStartWith("workspace-e2e-bun-");
    // Only the miss-gated fill runs between the restore and the save;
    // workspace-e2e-bun-cache-fill.test.ts executes it against a hostile
    // checkout.
    expect(
      stepsBetweenNames("Restore Bun package cache", "Save Bun package cache")
    ).toEqual([restore, fill]);
    expect(fill.if).toBe(save.if);
  });

  test("runs no exact-SHA code before the Bun package cache is saved", () => {
    const steps = testJob?.steps ?? [];
    const saveIndex = steps.findIndex(
      (step) => step.name === "Save Bun package cache"
    );
    expect(saveIndex).toBeGreaterThan(0);
    const beforeSave = steps.slice(0, saveIndex);

    // Bun runs before the save only to fill the cache.
    expect(
      beforeSave
        .filter((step) => /\bbunx?\b/.test(step.run ?? ""))
        .map((step) => step.name)
    ).toEqual(["Fill Bun package cache from install manifests"]);

    // Local actions come from the workflow commit, not the exact-SHA checkout.
    const coordinatorCheckout = stepByName("Checkout allocation action");
    expect(coordinatorCheckout.with?.ref).toContain("github.workflow_sha");
    const localActions = beforeSave.filter((step) =>
      (step.uses ?? "").startsWith("./")
    );
    expect(localActions.length).toBeGreaterThan(0);
    for (const step of localActions) {
      expect(step.uses).toStartWith(`./${coordinatorCheckout.with?.path}/`);
    }
  });

  test("runs install lifecycle scripts after the Bun package cache is saved", () => {
    const steps = testJob?.steps ?? [];
    const install = stepByName("Install repository dependencies");
    expect(steps.indexOf(install)).toBeGreaterThan(
      steps.indexOf(stepByName("Save Bun package cache"))
    );
    // The fill installs outside the checkout, so this install always starts
    // from an empty tree and runs every lifecycle script.
    expect(install.if).toBeUndefined();
    expect(install.run?.trim()).toBe("bun install --frozen-lockfile");
  });

  test("keeps the Bun binary out of the shared Actions cache", () => {
    // setup-bun would save it after exact-SHA code ran, into the
    // default-branch scope every workflow restores from.
    const setupBunSteps = allSteps.filter((step) =>
      (step.uses ?? "").startsWith("oven-sh/setup-bun@")
    );
    expect(setupBunSteps.length).toBeGreaterThan(0);
    for (const step of setupBunSteps) {
      expect(step.with?.["no-cache"]).toBe(true);
    }
  });
});
