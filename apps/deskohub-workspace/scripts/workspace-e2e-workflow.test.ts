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
  parseCompositeAction,
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
const bunReleaseCacheDoc = parseWorkflow(
  resolve(import.meta.dir, "../../../.github/workflows/bun-release-cache.yml")
);
const setupBunAction = parseCompositeAction(
  resolve(import.meta.dir, "../../../.github/actions/setup-bun/action.yml")
);
const playwrightWebKitCacheDoc = parseWorkflow(
  resolve(
    import.meta.dir,
    "../../../.github/workflows/playwright-webkit-cache.yml"
  )
);
const restorePlaywrightWebKitAction = parseCompositeAction(
  resolve(
    import.meta.dir,
    "../../../.github/actions/restore-playwright-webkit/action.yml"
  )
);
const workflowDispatchInputs = doc.on?.workflow_dispatch?.inputs;
// Format-insensitive view of the parsed workflow used for document-level
// token presence/absence checks; assertions never touch raw file text.
const serializedWorkflow = JSON.stringify(doc);
const serializedProductionWorkflow = JSON.stringify(productionDoc);
const stepNames = workflowStepNames(doc);
const allSteps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
const testJob = doc.jobs["test-e2e"];
const fillJob = doc.jobs["fill-bun-package-cache"];
const cacheMode = (job: string) =>
  doc.jobs[job]?.["cache-mode"] ?? doc["cache-mode"];

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
      // Reads the exact-SHA checkout and saves the Bun package cache.
      "fill-bun-package-cache": { contents: "read" },
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

    expect(testJob.needs).toEqual(["resolve-target", "fill-bun-package-cache"]);
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
      "Checkout workflow actions"
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
      "fill-bun-package-cache",
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

  test("fills the Bun package cache in a job that runs no exact-SHA code", () => {
    const steps = fillJob?.steps ?? [];
    const lookup = stepByName("Look up Bun package cache");
    const fill = stepByName("Fill Bun package cache from install manifests");
    const save = stepByName("Save Bun package cache");
    for (const step of [lookup, fill, save]) {
      expect(steps).toContain(step);
    }
    expect(lookup.uses).toStartWith("actions/cache/restore@");
    expect(lookup.with?.["lookup-only"]).toBe(true);
    expect(lookup.with?.["restore-keys"]).toBeUndefined();
    expect(String(lookup.with?.key)).toStartWith("workspace-e2e-bun-");
    expect(save.uses).toStartWith("actions/cache/save@");
    expect(save.with?.key).toBe(
      `\${{ steps.${lookup.id}.outputs.cache-primary-key }}`
    );
    expect(save.with?.path).toBe(lookup.with?.path);
    const miss = `steps.${lookup.id}.outputs.cache-hit != 'true'`;
    expect(fill.if).toBe(miss);
    expect(save.if).toBe(miss);
    // Bun runs only to fill the cache; workspace-e2e-bun-cache-fill.test.ts
    // executes the fill against a hostile checkout.
    expect(
      steps
        .filter((step) => /\bbunx?\b/.test(step.run ?? ""))
        .map((step) => step.name)
    ).toEqual(["Fill Bun package cache from install manifests"]);
    expect(steps.at(-1)).toBe(save);
    // Its only local action comes from the workflow commit.
    const actionsCheckout = stepByName("Checkout Bun setup action");
    expect(actionsCheckout.with?.ref).toContain("github.workflow_sha");
    const localActions = steps.filter((step) =>
      (step.uses ?? "").startsWith("./")
    );
    expect(localActions.map((step) => step.uses)).toEqual([
      `./${actionsCheckout.with?.path}/.github/actions/setup-bun`,
    ]);
    const fillSetup = stepByName("Set up Bun for the package cache fill");
    const e2eSetup = stepByName("Set up Bun");
    expect(fillSetup.if).toBe(miss);
    expect(fillSetup.with).toEqual(e2eSetup.with);
    expect(fillJob?.permissions).toEqual({ contents: "read" });
  });

  test("keeps the supersession guard alive while the fill and test jobs run", () => {
    const guard = doc.jobs["cancel-superseded-run"];
    expect(guard?.needs).toBe("resolve-target");
    expect(guard?.["timeout-minutes"]).toBeGreaterThan(
      (fillJob?.["timeout-minutes"] ?? Number.POSITIVE_INFINITY) +
        (testJob?.["timeout-minutes"] ?? Number.POSITIVE_INFINITY)
    );
  });

  test("names a failed Bun package cache fill in the allocation status", () => {
    const description = String(
      stepByName("Publish final commit status").env?.ALLOCATION_DESCRIPTION
    );
    const allocationDescription = (
      fill: string,
      shard: string,
      release: string
    ) =>
      evaluateWorkflowValue(description, {
        contexts: ["needs"],
        values: new Map([
          [
            "needs.fill-bun-package-cache.result",
            workflowExpressionString(fill),
          ],
          ["needs.test-e2e.outputs.shard", workflowExpressionString(shard)],
          [
            "needs.test-e2e.outputs.release_outcome",
            workflowExpressionString(release),
          ],
        ]),
      });
    expect(allocationDescription("failure", "", "")).toBe(
      "Workspace E2E Bun package cache fill failed"
    );
    expect(allocationDescription("success", "", "")).toBe(
      "Workspace E2E shard allocation failed"
    );
    expect(allocationDescription("success", "3", "success")).toBe(
      "Workspace E2E shard released"
    );
    expect(allocationDescription("success", "3", "failure")).toBe(
      "Workspace E2E shard release failed"
    );
  });

  test("restores the Bun package cache test-e2e installs from, saving nothing", () => {
    const steps = testJob?.steps ?? [];
    const restore = stepByName("Restore Bun package cache");
    const install = stepByName("Install repository dependencies");
    expect(steps).toContain(restore);
    expect(restore.uses).toStartWith("actions/cache/restore@");
    expect(restore.with?.["restore-keys"]).toBeUndefined();
    expect(restore.with?.["lookup-only"]).toBeUndefined();
    const lookup = stepByName("Look up Bun package cache");
    expect(restore.with?.key).toBe(lookup.with?.key);
    expect(restore.with?.path).toBe(lookup.with?.path);
    // The fill job finishes before test-e2e starts.
    expect(testJob?.needs).toContain("fill-bun-package-cache");
    expect(fillJob?.needs).toBe("resolve-target");
    expect(fillJob?.if).toBe(testJob?.if);
    expect(steps.indexOf(install)).toBeGreaterThan(steps.indexOf(restore));
    // The fill installs outside the checkout, so this install always starts
    // from an empty tree and runs every lifecycle script.
    expect(install.if).toBeUndefined();
    expect(install.run?.trim()).toBe("bun install --frozen-lockfile");
  });

  test("sets up Bun from the workflow commit before any exact-SHA code runs", () => {
    const steps = testJob?.steps ?? [];
    const setupBun = stepByName("Set up Bun");
    const coordinatorCheckout = stepByName("Checkout workflow actions");
    expect(setupBun.uses).toBe(
      `./${coordinatorCheckout.with?.path}/.github/actions/setup-bun`
    );
    expect(String(coordinatorCheckout.with?.["sparse-checkout"])).toContain(
      ".github/actions/setup-bun"
    );
    // Bun is in place before the package cache steps, the first that run it.
    const setupIndex = steps.indexOf(setupBun);
    expect(setupIndex).toBeGreaterThan(steps.indexOf(coordinatorCheckout));
    expect(setupIndex).toBeLessThan(
      steps.indexOf(stepByName("Restore Bun package cache"))
    );
    expect(
      steps
        .slice(0, setupIndex)
        .filter((step) => /\bbunx?\b/.test(step.run ?? ""))
    ).toEqual([]);
    // The job never calls setup-bun directly, whose cache would save the
    // binary after exact-SHA code ran.
    expect(
      allSteps.filter((step) =>
        (step.uses ?? "").startsWith("oven-sh/setup-bun@")
      )
    ).toEqual([]);
  });

  test("installs Bun only from an archive matching the pinned digest, saving nothing", () => {
    const steps = setupBunAction.runs.steps;
    expect(steps.map((step) => step.name)).toEqual([
      "Restore Bun release",
      "Download Bun release",
      "Install verified Bun release",
      "Set up Bun",
    ]);
    const [restore, download, install, setup] = steps;
    expect(restore?.uses).toStartWith("actions/cache/restore@");
    expect(restore?.with?.["restore-keys"]).toBeUndefined();
    for (const part of ["inputs.bun-version", "runner.os", "runner.arch"]) {
      expect(String(restore?.with?.key)).toContain(part);
    }
    expect(setupBunAction.outputs?.path?.value).toBe(restore?.with?.path);
    expect(download?.if).toBe("steps.restore.outputs.cache-hit != 'true'");
    expect(download?.run).toContain("--retry-all-errors");
    // A restored archive is checked as strictly as a downloaded one.
    expect(install?.if).toBeUndefined();
    expect(install?.env?.BUN_SHA256).toContain("inputs.bun-sha256");
    expect(install?.run).toContain("sha256sum --check --strict");
    // setup-bun then finds the requested version installed and reuses it.
    expect(setup?.uses).toStartWith("oven-sh/setup-bun@");
    expect(setup?.with?.["no-cache"]).toBe(true);
    expect(
      steps.filter((step) => /^actions\/cache(\/save)?@/.test(step.uses ?? ""))
    ).toEqual([]);
  });

  test("saves the Bun release only from main's code, before anything else runs", () => {
    const warmSteps = bunReleaseCacheDoc.jobs.warm?.steps ?? [];
    expect(warmSteps.map((step) => step.uses?.replace(/@.*/, ""))).toEqual([
      "actions/checkout",
      "./.github/actions/setup-bun",
      "actions/cache/save",
    ]);
    const [checkout, setup, save] = warmSteps;
    expect(checkout?.with?.ref).toBeUndefined();
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(save?.if).toContain("github.ref == 'refs/heads/main'");
    expect(save?.if).toContain(
      `steps.${setup?.id}.outputs.cache-hit != 'true'`
    );
    expect(save?.with?.path).toBe(`\${{ steps.${setup?.id}.outputs.path }}`);
    expect(save?.with?.key).toBe(
      `\${{ steps.${setup?.id}.outputs.cache-primary-key }}`
    );
    // The writer saves the release Workspace E2E restores.
    const e2eSetup = stepByName("Set up Bun");
    expect(setup?.with?.["bun-version"]).toBe(e2eSetup.with?.["bun-version"]);
    expect(setup?.with?.["bun-sha256"]).toBe(e2eSetup.with?.["bun-sha256"]);
    expect(String(e2eSetup.with?.["bun-sha256"])).toMatch(/^[0-9a-f]{64}$/);
    expect(bunReleaseCacheDoc.permissions).toEqual({ contents: "read" });
  });

  test("gives only the job that runs no exact-SHA code a cache token that can save", () => {
    // Dispatch triggers default to write access, and exact-SHA code could
    // reach a later action's token, so every job but the fill gets a
    // read-only one and GitHub refuses its saves.
    expect(doc["cache-mode"]).toBe("read");
    expect(
      Object.fromEntries(
        Object.keys(doc.jobs).map((name) => [name, cacheMode(name)])
      )
    ).toEqual({
      "resolve-target": "read",
      "fill-bun-package-cache": "write",
      "test-e2e": "read",
      "cancel-superseded-run": "read",
      "publish-final-status": "read",
      "publish-status-without-run": "read",
    });
    // actions/cache saves in its post-job step, so the workflow uses only
    // the explicit restore and save actions, and saves only in the fill job.
    expect(
      allSteps.filter((step) => /^actions\/cache@/.test(step.uses ?? ""))
    ).toEqual([]);
    expect(
      Object.entries(doc.jobs).flatMap(([name, job]) =>
        (job.steps ?? [])
          .filter((step) => /^actions\/cache\/save@/.test(step.uses ?? ""))
          .map((step) => `${name}: ${step.name}`)
      )
    ).toEqual(["fill-bun-package-cache: Save Bun package cache"]);
    // test-e2e's local actions restore without saving.
    for (const action of [setupBunAction, restorePlaywrightWebKitAction]) {
      expect(
        action.runs.steps.filter((step) =>
          /^actions\/cache(\/save)?@/.test(step.uses ?? "")
        )
      ).toEqual([]);
    }
  });

  test("restores Playwright WebKit from the workflow commit before any exact-SHA code runs", () => {
    const steps = testJob?.steps ?? [];
    const restore = stepByName("Restore Workspace Playwright WebKit");
    const coordinatorCheckout = stepByName("Checkout workflow actions");
    expect(restore.uses).toBe(
      `./${coordinatorCheckout.with?.path}/.github/actions/restore-playwright-webkit`
    );
    expect(String(coordinatorCheckout.with?.["sparse-checkout"])).toContain(
      ".github/actions/restore-playwright-webkit"
    );
    const restoreIndex = steps.indexOf(restore);
    expect(restoreIndex).toBeGreaterThan(steps.indexOf(coordinatorCheckout));
    expect(restoreIndex).toBeLessThan(
      steps.indexOf(stepByName("Install repository dependencies"))
    );
    // A hit or a miss, the install step still runs: it installs WebKit's
    // system packages and downloads the browser only when it is missing.
    const install = stepByName("Install Workspace Playwright WebKit");
    expect(steps.indexOf(install)).toBeGreaterThan(restoreIndex);
    expect(install.if).toBeUndefined();
    expect(install.run).toContain("install --with-deps webkit");
  });

  test("restores only the WebKit build of the Workspace's exact Playwright pin", () => {
    const steps = restorePlaywrightWebKitAction.runs.steps;
    expect(steps.map((step) => step.name)).toEqual([
      "Resolve Workspace Playwright version",
      "Restore Playwright WebKit",
    ]);
    const [version, restore] = steps;
    // The pin is read as data, never by running exact-SHA code.
    expect(version?.run).toContain("apps/deskohub-workspace/package.json");
    expect(version?.run).not.toMatch(/\bbunx?\b|\bnode\b|\bnpx\b/);
    expect(restore?.uses).toStartWith("actions/cache/restore@");
    expect(restore?.with?.["restore-keys"]).toBeUndefined();
    // The prefix is new, so no entry an earlier E2E run saved after its
    // exact-SHA code matches it.
    expect(String(restore?.with?.key)).toStartWith(
      "workspace-e2e-playwright-webkit-"
    );
    for (const part of [
      "runner.os",
      "runner.arch",
      `steps.${version?.id}.outputs.image-os`,
      `steps.${version?.id}.outputs.version`,
    ]) {
      expect(String(restore?.with?.key)).toContain(part);
    }
    expect(restorePlaywrightWebKitAction.outputs?.path?.value).toBe(
      restore?.with?.path
    );
    expect(restore?.with?.path).toBe("~/.cache/ms-playwright");
  });

  test("saves Playwright WebKit only from main's code and main's pin", () => {
    const warm = playwrightWebKitCacheDoc.jobs.warm;
    const warmSteps = warm?.steps ?? [];
    expect(warmSteps.map((step) => step.uses?.replace(/@.*/, ""))).toEqual([
      "actions/checkout",
      "./.github/actions/restore-playwright-webkit",
      undefined,
      "actions/cache/save",
    ]);
    const [checkout, restore, download, save] = warmSteps;
    expect(checkout?.with?.ref).toBeUndefined();
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    const miss = `steps.${restore?.id}.outputs.cache-hit != 'true'`;
    expect(download?.if).toBe(miss);
    expect(download?.env?.PLAYWRIGHT_VERSION).toBe(
      `\${{ steps.${restore?.id}.outputs.version }}`
    );
    expect(download?.run).toContain("install webkit");
    expect(save?.if).toContain("github.ref == 'refs/heads/main'");
    expect(save?.if).toContain(miss);
    expect(save?.with?.path).toBe(`\${{ steps.${restore?.id}.outputs.path }}`);
    expect(save?.with?.key).toBe(
      `\${{ steps.${restore?.id}.outputs.cache-primary-key }}`
    );
    // The key holds the runner image, so the writer runs on E2E's runner.
    expect(warm?.["runs-on"]).toBe(testJob?.["runs-on"]);
    expect(playwrightWebKitCacheDoc.permissions).toEqual({
      contents: "read",
    });
  });
});
