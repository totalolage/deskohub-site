import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workspaceE2EPlaywrightCheckoutTimeout } from "../e2e/timeouts";
import {
  callsNamed,
  identifierNames,
  importSpecifiers,
  methodCallsNamed,
  nodesOf,
  parseSource,
  parseTrackedSource,
  positionDelta,
  stringLiterals,
} from "./shared/source-ast";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowStep,
  workflowStepNames,
} from "./shared/workflow-contract";

type PlaywrightCheckoutConfig =
  typeof import("../playwright.e2e.config")["default"];

let cachedConfigStructure: PlaywrightCheckoutConfig | undefined;
// The real Playwright config is executed (not text-scanned) and its resolved
// structure is asserted on. It runs in a child process because the config
// resolves its browser executable with a top-level await, which bun's test
// runner does not settle reliably across multiple entry files.
const playwrightConfigStructure = (): PlaywrightCheckoutConfig => {
  if (cachedConfigStructure === undefined) {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        'const config = (await import("./playwright.e2e.config")).default; console.log(JSON.stringify(config));',
      ],
      cwd: resolve(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
    cachedConfigStructure = JSON.parse(
      new TextDecoder().decode(result.stdout)
    ) as PlaywrightCheckoutConfig;
  }
  return cachedConfigStructure;
};

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/workspace-e2e.yml"
);
const productionWorkflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/deploy-workspace-production.yml"
);

const doc = parseWorkflow(workflowPath);
const productionDoc = parseWorkflow(productionWorkflowPath);
// Format-insensitive view of the parsed workflow used for document-level
// token presence/absence checks; assertions never touch raw file text.
const serializedWorkflow = JSON.stringify(doc);
const serializedProductionWorkflow = JSON.stringify(productionDoc);
// Same view with JSON string escapes resolved, for checks on expression
// spellings that contain double quotes.
const unescapedWorkflow = serializedWorkflow.replaceAll('\\"', '"');
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

/** Parsed syntax tree of a tracked repository module. */
const parseTrackedModule = (path: string) =>
  parseTrackedSource(resolve(import.meta.dir, path));

const projectByName = (config: PlaywrightCheckoutConfig, name: string) =>
  config.projects.find((project) => project.name === name);

const jobHasConcurrencyLock = (
  job: WorkflowJob & { readonly concurrency?: unknown }
): boolean => job.concurrency !== undefined;

describe("workspace E2E workflow", () => {
  test("keeps the atomic allocator isolated from exact-SHA test code", () => {
    // The legacy in-workflow shard job is gone; allocation is the composite
    // coordinator action with persisted-credentials disabled.
    expect(Object.keys(doc.jobs).includes("allocate-shard")).toBe(false);
    const allocationAction = allSteps.find(
      (step) =>
        step.uses ===
        "./.workspace-e2e-coordinator/.github/actions/workspace-e2e-allocation"
    );
    expect(allocationAction).toBeDefined();
    const tokenCheckouts = allSteps.filter((step) =>
      (step.uses ?? "").startsWith("actions/checkout")
    );
    expect(tokenCheckouts.length).toBeGreaterThan(0);
    for (const checkout of tokenCheckouts) {
      expect(checkout.with?.["persist-credentials"]).toBe(false);
    }
    expect(serializedWorkflow.includes("workspace-e2e-shard-allocation")).toBe(
      false
    );
    expect(serializedWorkflow.includes("allow_concurrent")).toBe(false);
    expect(
      serializedWorkflow.includes("inputs.cleanup_stale_e2e_reservations")
    ).toBe(true);
    expect(
      Object.values(doc.jobs).every(
        (job) => job.permissions?.contents !== "write"
      )
    ).toBe(true);
    expect(doc.permissions?.contents).not.toBe("write");
    expect(
      JSON.stringify(allocationAction?.with ?? {}).includes(
        "secrets.WORKSPACE_E2E_COORDINATOR_DATABASE_URL"
      )
    ).toBe(true);

    const runE2EEnv = stepByName("Run checkout E2E").env;
    expect(runE2EEnv?.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL).toBe(
      `\${{ secrets.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL }}`
    );
    expect(runE2EEnv?.WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED).toBe("true");
    expect(serializedWorkflow.includes("workspace-e2e-dotypos-sandbox")).toBe(
      false
    );

    expect(JSON.stringify(testJob.permissions)).toBe(
      JSON.stringify({ actions: "read", contents: "read", statuses: "write" })
    );
    expect(allSteps.some((step) => step.id === "release")).toBe(true);
    expect(
      (testJob.steps ?? []).some((step) =>
        JSON.stringify(step.outputs ?? step.env ?? {}).includes(
          "steps.release.outcome"
        )
      ) || serializedWorkflow.includes("steps.release.outcome")
    ).toBe(true);
    expect(
      JSON.stringify(doc.jobs["publish-final-status"]).includes(
        "needs.test-e2e.outputs.release_outcome == 'success'"
      )
    ).toBe(true);
    expect(
      serializedWorkflow.includes("Workspace E2E shard release failed")
    ).toBe(true);
    expect(stepNames).toContain("Validate aggregate Dotypos capacity");
    expect(stepNames).toContain("Reconcile stale Workspace E2E reservations");
    expect(
      stepByName("Reconcile stale Workspace E2E reservations").run?.includes(
        "e2e:cleanup-stale --apply"
      )
    ).toBe(true);

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
    expect(serializedWorkflow.includes("pulls?state=open")).toBe(false);
  });

  test("binds the manual target origin to a successful exact-SHA Workspace deployment", () => {
    const resolveStep = stepsBetweenNames(
      "Resolve eligible PR and immutable preview",
      "Migrate preview database"
    )
      .map((step) => step.run ?? "")
      .join("\n");

    expect(
      Object.values(doc.jobs).some((job) =>
        JSON.stringify(job.permissions ?? {}).includes("deployments")
      ) || doc.permissions?.deployments === "read"
    ).toBe(true);
    expect(resolveStep.includes('"repos/$GITHUB_REPOSITORY/deployments"')).toBe(
      true
    );
    expect(resolveStep.includes('-f sha="$TARGET_SHA"')).toBe(true);
    expect(
      resolveStep.includes("-f environment='Preview – deskohub-workspace-site'")
    ).toBe(true);
    expect(
      resolveStep.includes(
        '"repos/$GITHUB_REPOSITORY/deployments/$deployment_id/statuses"'
      )
    ).toBe(true);
    expect(resolveStep.includes('--arg target "$normalized_url"')).toBe(true);
    expect(resolveStep.includes('.state == "success"')).toBe(true);
    expect(
      resolveStep.includes(
        "No successful exact-SHA Workspace deployment matches the target URL"
      )
    ).toBe(true);
  });

  test("waives exact-SHA E2E only when Vercel marks Workspace unaffected", () => {
    const skippedJob = doc.jobs["publish-skipped-status"];
    const rawSkipped = JSON.stringify(skippedJob);

    expect(serializedWorkflow.includes("vercel.deployment.skipped")).toBe(true);
    expect(serializedWorkflow.includes("TARGET_SKIPPED")).toBe(true);
    expect(unescapedWorkflow.includes('.creator.login == "vercel[bot]"')).toBe(
      true
    );
    expect(unescapedWorkflow.includes('.state == "inactive"')).toBe(true);
    expect(
      unescapedWorkflow.includes('.description == "Skipped - Not affected"')
    ).toBe(true);
    expect(unescapedWorkflow.includes('context == "Workspace E2E"')).toBe(true);
    expect(serializedWorkflow.includes("gh api --paginate --slurp")).toBe(true);
    expect(serializedWorkflow.includes("target_seen=true")).toBe(true);
    expect(
      unescapedWorkflow.includes('if [[ "$target_seen" != "true" ]]')
    ).toBe(true);
    expect(
      serializedWorkflow.includes("Workspace unchanged; prior E2E did not pass")
    ).toBe(true);
    expect(
      (doc.jobs["publish-final-status"].if ?? "").includes(
        "needs.resolve-target.outputs.skipped != 'true'"
      )
    ).toBe(true);
    expect(
      JSON.stringify(skippedJob.permissions ?? {}).includes("statuses")
    ).toBe(true);
    expect(
      Object.values(doc.jobs["publish-skipped-status"].steps ?? [])
        .map((step) => step.run ?? "")
        .join("\n")
        .includes('"repos/$GITHUB_REPOSITORY/statuses/$TARGET_SHA"')
    ).toBe(true);
    expect(rawSkipped.includes("-f context='Workspace E2E'")).toBe(true);
    expect(
      serializedWorkflow.includes("Workspace unchanged; E2E skipped")
    ).toBe(true);
    expect(rawSkipped.includes("vercel deploy")).toBe(false);
  });

  test("classifies the synthetic main account only after a failed E2E run", () => {
    const packageJson = readTrackedJson("../package.json") as {
      readonly scripts: Record<string, string | undefined>;
    };
    expect(packageJson.scripts["e2e:account-state"]).toBe(
      "bun scripts/workspace-e2e-account-state.ts"
    );

    const uploadIndex = allSteps.findIndex(
      (step) => step.uses === "actions/upload-artifact@v4"
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
    const diagnosticEnv = diagnostic.env;
    expect(diagnostic.if).toBe("failure()");
    expect(diagnostic["continue-on-error"]).toBe(true);
    expect(diagnostic.run).toBe(
      "bun --cwd apps/deskohub-workspace e2e:account-state"
    );
    expect(diagnosticEnv?.DATABASE_URL).toBe(
      `\${{ steps.preview-database.outputs.direct_url }}`
    );
    expect(diagnosticEnv?.WORKSPACE_E2E_DATABASE_URL_UNPOOLED).toBe(
      `\${{ steps.preview-database.outputs.direct_url }}`
    );
    expect(diagnosticEnv?.WORKSPACE_E2E_DATABASE_ALLOWLIST).toBe(
      `\${{ steps.preview-database.outputs.direct_url }}`
    );
    expect(
      JSON.stringify(diagnosticEnv).includes(
        "secrets.WORKSPACE_E2E_DOTYPOS_CLIENT_SECRET"
      )
    ).toBe(true);
    expect(
      JSON.stringify(diagnosticEnv).includes("WORKSPACE_E2E_RESEND_API_KEY")
    ).toBe(false);
    expect(
      JSON.stringify(diagnosticEnv).includes("WORKSPACE_E2E_PROVIDER_PERMIT")
    ).toBe(false);
    expect(
      JSON.stringify(diagnosticEnv).includes(
        "WORKSPACE_E2E_COORDINATOR_DATABASE_URL"
      )
    ).toBe(false);
  });

  test("uses the allocator without a global provider lock", () => {
    // Assert on the parsed job object so a reintroduced job-level
    // concurrency lock is caught regardless of its YAML spelling or position.
    expect(jobHasConcurrencyLock(testJob)).toBe(false);
    // Negative fixture: the assertion above must fail once the job carries a
    // concurrency lock again.
    expect(
      jobHasConcurrencyLock({ ...testJob, concurrency: { group: "e2e" } })
    ).toBe(true);

    const names = stepNames;
    const targetCheckoutIndex = names.indexOf("Checkout exact target");
    const coordinatorCheckoutIndex = names.indexOf(
      "Checkout allocation action"
    );
    const leaseIndex = names.indexOf("Lease an available date shard");
    const runIndex = names.indexOf("Run checkout E2E");
    const releaseIndex = names.indexOf("Release date shard");

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
    expect(environment).toContain("WORKSPACE_E2E_RESEND_API_KEY");
  });

  test("generates the Igloohome client before Workspace E2E startup", () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "turbo",
        "run",
        "test:e2e",
        "--filter=deskohub-workspace",
        "--dry=json",
      ],
      cwd: resolve(import.meta.dir, "../../../"),
      env: { ...process.env, TURBO_UI: "false" },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const output = new TextDecoder().decode(result.stdout);
    const jsonStart = output.indexOf("{");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const graph = JSON.parse(output.slice(jsonStart)) as {
      readonly tasks: readonly {
        readonly command: string;
        readonly dependencies: readonly string[];
        readonly directory: string;
        readonly outputs: readonly string[] | null;
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
    const generatorTask = graph.tasks.find(
      (task) => task.taskId === "@deskohub/igloohome#generate"
    );
    const i18nTask = graph.tasks.find(
      (task) => task.taskId === "deskohub-workspace#i18n:compile"
    );

    expect(e2eTask).toBeDefined();
    expect(generatorTask).toBeDefined();
    expect(i18nTask).toBeDefined();
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
    expect(generatorTask?.command).toContain(
      "generate-effect-openapi-client.ts"
    );
    expect(generatorTask?.directory).toBe("packages/igloohome");
    expect(generatorTask?.outputs).toEqual(["src/generated/**"]);
    expect(i18nTask?.directory).toBe("apps/deskohub-workspace");
  });

  test("keeps the Resend retrieval key inside the account Playwright execution only", () => {
    const runE2EEnv = stepByName("Run checkout E2E").env;
    expect(runE2EEnv?.WORKSPACE_E2E_RESEND_API_KEY).toBe(
      `\${{ secrets.WORKSPACE_E2E_RESEND_API_KEY }}`
    );

    // Exactly the Playwright checkout step: one env key plus its secret
    // reference, counted over the serialized parsed workflow structure.
    expect(
      serializedWorkflow.split("WORKSPACE_E2E_RESEND_API_KEY").length - 1
    ).toBe(2);

    expect(serializedWorkflow.includes("secrets.RESEND_API_KEY")).toBe(false);
    expect(
      serializedProductionWorkflow.includes("WORKSPACE_E2E_RESEND_API_KEY")
    ).toBe(false);
    expect(serializedProductionWorkflow.includes("EMAIL_API_KEY")).toBe(false);
    expect(serializedProductionWorkflow.includes("BETTER_AUTH")).toBe(false);

    const turbo = readTrackedJson("../../../turbo.json") as {
      readonly global?: { readonly passThroughEnv?: string[] };
    };
    const turboGlobal = turbo.global?.passThroughEnv ?? [];
    expect(turboGlobal).not.toContain("WORKSPACE_E2E_RESEND_API_KEY");
  });

  test("runs invoice persistence inside the normal exact-SHA Playwright graph", () => {
    const playwrightConfig = playwrightConfigStructure();
    const packageJson = readTrackedJson("../package.json") as {
      readonly scripts: Record<string, string | undefined>;
      readonly dependencies: Record<string, string>;
    };
    const testUnit = packageJson.scripts.test as string;
    const testE2E = packageJson.scripts["test:e2e"] as string;
    const turbo = readTrackedJson<{ readonly tasks: object }>("../turbo.json");

    expect(testE2E).toBe("bun scripts/workspace-e2e.ts");
    expect(packageJson.dependencies["server-only"]).toBe("^0.0.1");
    expect(packageJson.scripts["test:accounting-persistence"]).toBeUndefined();
    expect(testUnit.includes("e2e.test.ts")).toBe(false);
    expect(turbo.tasks["test:accounting-persistence"]).toBeUndefined();

    const invoiceProject = projectByName(
      playwrightConfig,
      "checkout-invoice-persistence"
    );
    expect(invoiceProject).toBeDefined();
    expect(invoiceProject?.testMatch).toBe("invoice-persistence.pw.ts");
    expect(invoiceProject?.dependencies).toEqual(["checkout-setup"]);
    expect(
      projectByName(playwrightConfig, "checkout-plan")?.dependencies
    ).toContain("checkout-invoice-persistence");

    // The Playwright phase imports the persistence assertion and owns the
    // single "invoice-persistence" phase id; verdicts come from the parsed
    // module, so comments and formatting cannot satisfy them.
    const invoicePhase = parseTrackedModule(
      "../e2e/playwright-checkout/invoice-persistence.pw.ts"
    );
    expect(
      identifierNames(invoicePhase.ast).has("assertInvoicePersistence")
    ).toBe(true);
    expect(
      stringLiterals(invoicePhase.ast).filter(
        (literal) => literal.value === "invoice-persistence"
      )
    ).toHaveLength(1);

    const integration = parseTrackedModule(
      "../e2e/integrations/invoice-persistence.ts"
    );
    // One delegated E2EDatabase requirement wires the disposable datasource.
    expect(
      nodesOf(integration.ast).filter(
        (node) =>
          node.type === "YieldExpression" &&
          node.delegate &&
          node.argument.type === "Identifier" &&
          node.argument.name === "E2EDatabase"
      )
    ).toHaveLength(1);
    // Persisted timestamps pass through the shared Temporal conversion, and
    // the synthetic-customer filter keys on the customer-id column.
    const temporalCalls = callsNamed(
      integration.ast,
      "temporalInstantToIsoString"
    );
    expect(temporalCalls).toHaveLength(1);
    expect(
      temporalCalls[0]!.arguments.length === 1 &&
        identifierNames(temporalCalls[0]!).has("Temporal")
    ).toBe(true);
    const likeCalls = callsNamed(integration.ast, "like").filter(
      (call) =>
        call.arguments[0]?.type === "MemberExpression" &&
        !call.arguments[0].computed &&
        call.arguments[0].object.type === "Identifier" &&
        call.arguments[0].object.name === "invoices" &&
        call.arguments[0].property.type === "Identifier" &&
        call.arguments[0].property.name === "dotyposCustomerId" &&
        call.arguments[1]?.type === "Literal" &&
        call.arguments[1].value === "synthetic-customer-%"
    );
    expect(likeCalls.length).toBeGreaterThan(0);
    // Email deliveries are cleaned before the immutable invoices table.
    const tableDelete = (table: string) =>
      callsNamed(integration.ast, "delete")
        .concat(methodCallsNamed(integration.ast, "delete"))
        .find(
          (call) =>
            call.arguments[0]?.type === "Identifier" &&
            call.arguments[0].name === table
        );
    const deliveryCleanup = tableDelete("invoiceEmailDeliveries");
    const invoiceCleanup = tableDelete("invoices");
    expect(deliveryCleanup).toBeDefined();
    expect(invoiceCleanup).toBeDefined();
    expect(positionDelta(deliveryCleanup!, invoiceCleanup!)).toBeLessThan(0);
    expect(
      identifierNames(integration.ast).has("WORKSPACE_E2E_DATABASE_ALLOWLIST")
    ).toBe(false);

    const databaseImports = importSpecifiers(
      parseTrackedModule("../db/database.service.ts").ast
    );
    const accountingKeyImports = importSpecifiers(
      parseTrackedModule(
        "../features/accounting/backend/accounting-snapshot-key.service.ts"
      ).ast
    );
    expect(databaseImports).not.toContain("@/env");
    expect(accountingKeyImports).not.toContain("@/env");
    expect(accountingKeyImports).not.toContain("server-only");
  });

  test("uses Playwright with the hosted runner browser without downloading another browser", () => {
    expect(serializedWorkflow.includes("playwright install --with-deps")).toBe(
      false
    );
    expect(serializedWorkflow.includes("command -v google-chrome")).toBe(true);
    expect(
      serializedWorkflow.includes("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
    ).toBe(true);
    expect(stepNames).toContain("Verify hosted browser runtime");
  });

  test("lets Playwright own checkout preparation, scheduling, and parallelism", () => {
    const playwrightConfig = playwrightConfigStructure();
    const entry = parseTrackedModule("workspace-e2e.ts");
    const suite = parseTrackedModule("../e2e/suite.ts");
    const cleanupRuntime = parseTrackedModule(
      "../e2e/playwright-checkout/cleanup-runtime-fixtures.ts"
    );
    const cleanup = parseTrackedModule(
      "../e2e/playwright-checkout/cleanup.pw.ts"
    );

    // Entry wiring: the real launcher points at the real config and forwards
    // exactly the derived Playwright environment, never the raw process env.
    expect(
      stringLiterals(entry.ast).some(
        (literal) => literal.value === "playwright.e2e.config.ts"
      )
    ).toBe(true);
    expect(identifierNames(entry.ast).has("playwrightEnvironment")).toBe(true);
    expect(
      nodesOf(entry.ast).some(
        (node) =>
          node.type === "SpreadElement" &&
          identifierNames(node).has("process") &&
          identifierNames(node).has("env")
      )
    ).toBe(false);

    // The imported Playwright config owns scheduling and parallelism.
    expect(playwrightConfig.fullyParallel).toBe(true);
    expect(playwrightConfig.maxFailures).toBe(1);
    expect(playwrightConfig.workers).toBe(6);
    expect(playwrightConfig.timeout).toBe(
      workspaceE2EPlaywrightCheckoutTimeout
    );
    // Executing the config already exercised the chromium resolver end to end.
    expect(projectByName(playwrightConfig, "checkout-setup")?.teardown).toBe(
      "checkout-cleanup"
    );
    expect(
      projectByName(playwrightConfig, "checkout-availability")
    ).toBeDefined();
    const checkoutPlan = projectByName(playwrightConfig, "checkout-plan");
    expect(checkoutPlan).toBeDefined();
    expect(checkoutPlan?.dependencies).toEqual([
      "checkout-availability",
      "checkout-provider-preparation",
      "checkout-invoice-persistence",
    ]);

    // The Effect suite stays out of the Playwright lane's concurrency story:
    // no Effect.forEach fan-out and no concurrency primitives, decided on
    // the parsed module rather than token text.
    const suiteIdentifiers = identifierNames(suite.ast);
    expect(
      nodesOf(suite.ast).some(
        (node) =>
          node.type === "MemberExpression" &&
          !node.computed &&
          node.object.type === "Identifier" &&
          node.object.name === "Effect" &&
          node.property.type === "Identifier" &&
          node.property.name === "forEach"
      )
    ).toBe(false);
    expect(suiteIdentifiers.has("Semaphore")).toBe(false);
    expect(suiteIdentifiers.has("Deferred")).toBe(false);

    expect(
      stringLiterals(cleanup.ast).some(
        (literal) => literal.value === "suite-cleanup"
      )
    ).toBe(true);
    const cleanupRuntimeIdentifiers = identifierNames(cleanupRuntime.ast);
    expect(
      cleanupRuntimeIdentifiers.has(
        "makeWorkspaceE2EProviderVerificationPermitLive"
      )
    ).toBe(false);
    expect(
      cleanupRuntimeIdentifiers.has("makeWorkspaceE2ECaseRuntimeLive")
    ).toBe(false);
  });

  test("preserves discount seeding and account phase dependencies", () => {
    const playwrightConfig = playwrightConfigStructure();
    expect(
      projectByName(playwrightConfig, "account-auth")?.dependencies
    ).toEqual(["checkout-plan"]);
    expect(
      projectByName(playwrightConfig, "checkout-availability")?.dependencies
    ).toEqual(["checkout-setup", "checkout-seed"]);
    expect(
      projectByName(playwrightConfig, "checkout-provider-preparation")
        ?.dependencies
    ).toEqual(["checkout-setup"]);
    expect(
      projectByName(playwrightConfig, "checkout-invoice-persistence")
        ?.dependencies
    ).toEqual(["checkout-setup"]);
  });

  test("lets Playwright schedule read-only navigation beside checkout cases", () => {
    const playwrightConfig = playwrightConfigStructure();
    const packageJson = readTrackedJson("../package.json") as {
      readonly scripts: Record<string, string>;
    };
    const instantNavigation = projectByName(
      playwrightConfig,
      "instant-navigation"
    );
    expect(Object.keys(doc.jobs).includes("test-instant-navigation")).toBe(
      false
    );
    expect(serializedWorkflow.includes("Run instant navigation E2E")).toBe(
      false
    );
    expect(JSON.stringify(testJob.needs)).toBe(
      JSON.stringify(["resolve-target", "migrate-preview"])
    );
    // The checkout job reuses the migrated preview; it never migrates itself.
    expect(
      (testJob.steps ?? []).some(
        (step) => step.name === "Migrate preview database"
      )
    ).toBe(false);
    expect(doc.jobs["publish-final-status"].needs).toEqual([
      "resolve-target",
      "test-e2e",
    ]);
    expect(instantNavigation).toBeDefined();
    expect(instantNavigation?.testDir).toBe("./e2e/instant-navigation");
    expect(playwrightConfig.fullyParallel).toBe(true);
    expect(playwrightConfig.workers).toBe(6);
    expect(packageJson.scripts["test:instant-navigation"]).toContain(
      "--project=instant-navigation"
    );
  });

  test("lets Playwright write complete GitHub job summaries", () => {
    const playwrightConfig = playwrightConfigStructure();
    expect(serializedWorkflow.includes("GITHUB_STEP_SUMMARY")).toBe(false);
    const summaryReporter = playwrightConfig.reporter?.find(
      (entry) =>
        Array.isArray(entry) &&
        String(entry[0]).includes("playwright-github-summary.ts")
    );
    expect(summaryReporter).toBeDefined();
  });
});
