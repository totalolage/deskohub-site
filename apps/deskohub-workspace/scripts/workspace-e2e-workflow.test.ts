import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countOccurrences, readTrackedSource } from "./shared/source-contract";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowStep,
  workflowStepNames,
} from "./shared/workflow-contract";

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/workspace-e2e.yml"
);

const doc = parseWorkflow(workflowPath);
const rawWorkflow = readFileSync(workflowPath, "utf8");
const stepNames = workflowStepNames(doc);
const allSteps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
const testJob = doc.jobs["test-e2e"];
const rawTestJob = JSON.stringify(testJob);

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
    expect(rawWorkflow.includes("group: workspace-e2e-shard-allocation")).toBe(
      false
    );
    expect(rawWorkflow.includes("allow_concurrent")).toBe(false);
    expect(rawWorkflow.includes("inputs.cleanup_stale_e2e_reservations")).toBe(
      true
    );
    expect(rawWorkflow.includes("contents: write")).toBe(false);
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
    expect(rawWorkflow.includes("workspace-e2e-dotypos-sandbox")).toBe(false);

    expect(JSON.stringify(testJob.permissions)).toBe(
      JSON.stringify({ actions: "read", contents: "read", statuses: "write" })
    );
    expect(allSteps.some((step) => step.id === "release")).toBe(true);
    expect(
      (testJob.steps ?? []).some((step) =>
        JSON.stringify(step.outputs ?? step.env ?? {}).includes(
          "steps.release.outcome"
        )
      ) ||
        rawWorkflow.includes(`release_outcome: \${{ steps.release.outcome }}`)
    ).toBe(true);
    expect(
      JSON.stringify(doc.jobs["publish-final-status"]).includes(
        "needs.test-e2e.outputs.release_outcome == 'success'"
      )
    ).toBe(true);
    expect(rawWorkflow.includes("Workspace E2E shard release failed")).toBe(
      true
    );
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
    expect(rawWorkflow.match(/pulls\?state=open/)).toBeNull();
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
      ) || rawWorkflow.includes("deployments: read")
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

    expect(rawWorkflow.includes("vercel.deployment.skipped")).toBe(true);
    expect(rawWorkflow.includes("TARGET_SKIPPED:")).toBe(true);
    expect(rawWorkflow.includes('.creator.login == "vercel[bot]"')).toBe(true);
    expect(rawWorkflow.includes('.state == "inactive"')).toBe(true);
    expect(
      rawWorkflow.includes('.description == "Skipped - Not affected"')
    ).toBe(true);
    expect(rawWorkflow.includes('context == "Workspace E2E"')).toBe(true);
    expect(rawWorkflow.includes("gh api --paginate --slurp")).toBe(true);
    expect(rawWorkflow.includes("target_seen=true")).toBe(true);
    expect(rawWorkflow.includes('if [[ "$target_seen" != "true" ]]')).toBe(
      true
    );
    expect(
      rawWorkflow.includes("Workspace unchanged; prior E2E did not pass")
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
    expect(rawWorkflow.includes("Workspace unchanged; E2E skipped")).toBe(true);
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
    expect(rawTestJob.includes("concurrency:")).toBe(false);

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
    const productionWorkflow = readFileSync(
      resolve(
        import.meta.dir,
        "../../../.github/workflows/deploy-workspace-production.yml"
      ),
      "utf8"
    );
    const turbo = readTrackedJson("../../../turbo.json") as {
      readonly global?: { readonly passThroughEnv?: string[] };
    };

    const runE2EEnv = stepByName("Run checkout E2E").env;
    expect(runE2EEnv?.WORKSPACE_E2E_RESEND_API_KEY).toBe(
      `\${{ secrets.WORKSPACE_E2E_RESEND_API_KEY }}`
    );

    const occurrences = countOccurrences(
      rawWorkflow,
      "WORKSPACE_E2E_RESEND_API_KEY"
    );
    expect(occurrences).toBe(2);

    expect(
      rawWorkflow.includes(`RESEND_API_KEY: \${{ secrets.RESEND_API_KEY }}`)
    ).toBe(false);
    expect(productionWorkflow.includes("WORKSPACE_E2E_RESEND_API_KEY")).toBe(
      false
    );
    expect(productionWorkflow.includes("EMAIL_API_KEY")).toBe(false);
    expect(productionWorkflow.includes("BETTER_AUTH")).toBe(false);

    const turboGlobal = turbo.global?.passThroughEnv ?? [];
    expect(turboGlobal).not.toContain("WORKSPACE_E2E_RESEND_API_KEY");
  });

  test("runs invoice persistence inside the normal exact-SHA Playwright graph", () => {
    const packageJson = readTrackedJson("../package.json") as {
      readonly scripts: Record<string, string | undefined>;
      readonly dependencies: Record<string, string>;
    };
    const testUnit = packageJson.scripts.test as string;
    const testE2E = packageJson.scripts["test:e2e"] as string;
    const turbo = readTrackedJson<{ readonly tasks: object }>("../turbo.json");
    const playwrightConfig = readTrackedSource(
      resolve(import.meta.dir, "../playwright.e2e.config.ts")
    );
    const invoicePersistenceProject = readTrackedSource(
      resolve(
        import.meta.dir,
        "../e2e/playwright-checkout/invoice-persistence.pw.ts"
      )
    );
    const invoicePersistence = readTrackedSource(
      resolve(import.meta.dir, "../e2e/integrations/invoice-persistence.ts")
    );
    const databaseContract = readTrackedSource(
      resolve(import.meta.dir, "../db/database.service.ts")
    );
    const accountingKeyContract = readTrackedSource(
      resolve(
        import.meta.dir,
        "../features/accounting/backend/accounting-snapshot-key.service.ts"
      )
    );

    expect(testE2E).toBe("bun scripts/workspace-e2e.ts");
    expect(packageJson.dependencies["server-only"]).toBe("^0.0.1");
    expect(packageJson.scripts["test:accounting-persistence"]).toBeUndefined();
    expect(testUnit.includes("e2e.test.ts")).toBe(false);
    expect(turbo.tasks["test:accounting-persistence"]).toBeUndefined();
    expect(
      countOccurrences(playwrightConfig, 'name: "checkout-invoice-persistence"')
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(playwrightConfig, '"checkout-invoice-persistence"')
    ).toBe(2);
    expect(
      countOccurrences(invoicePersistenceProject, "assertInvoicePersistence")
    ).toBeGreaterThan(0);
    expect(
      countOccurrences(
        invoicePersistenceProject,
        'phaseId: "invoice-persistence"'
      )
    ).toBe(1);
    expect(countOccurrences(invoicePersistence, "yield* E2EDatabase")).toBe(1);
    expect(
      countOccurrences(
        invoicePersistence,
        "temporalInstantToIsoString(Temporal.Now.instant())"
      )
    ).toBe(1);
    expect(
      countOccurrences(
        invoicePersistence,
        'like(invoices.dotyposCustomerId, "synthetic-customer-%")'
      )
    ).toBeGreaterThan(0);
    const deliveryCleanup = invoicePersistence.indexOf(
      ".delete(invoiceEmailDeliveries)"
    );
    expect(deliveryCleanup).toBeGreaterThan(-1);
    expect(deliveryCleanup).toBeLessThan(
      invoicePersistence.indexOf(".delete(invoices)")
    );
    expect(
      countOccurrences(invoicePersistence, "WORKSPACE_E2E_DATABASE_ALLOWLIST")
    ).toBe(0);
    expect(countOccurrences(databaseContract, 'from "@/env"')).toBe(0);
    expect(countOccurrences(accountingKeyContract, 'from "@/env"')).toBe(0);
    expect(
      countOccurrences(accountingKeyContract, 'import "server-only"')
    ).toBe(0);
  });

  test("uses Playwright with the hosted runner browser without downloading another browser", () => {
    expect(rawWorkflow.includes("playwright install --with-deps")).toBe(false);
    expect(rawWorkflow.includes("command -v google-chrome")).toBe(true);
    expect(rawWorkflow.includes("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")).toBe(
      true
    );
    expect(stepNames).toContain("Verify hosted browser runtime");
  });

  test("lets Playwright own checkout preparation, scheduling, and parallelism", () => {
    const entry = readTrackedSource(
      resolve(import.meta.dir, "workspace-e2e.ts")
    );
    const suite = readTrackedSource(
      resolve(import.meta.dir, "../e2e/suite.ts")
    );
    const cleanupRuntime = readTrackedSource(
      resolve(
        import.meta.dir,
        "../e2e/playwright-checkout/cleanup-runtime-fixtures.ts"
      )
    );
    const config = readTrackedSource(
      resolve(import.meta.dir, "../playwright.e2e.config.ts")
    );

    expect(entry.includes("playwright.e2e.config.ts")).toBe(true);
    expect(config.includes("fullyParallel: true")).toBe(true);
    expect(config.includes("maxFailures: 1")).toBe(true);
    expect(config.includes("workers: 6")).toBe(true);
    expect(config.includes('teardown: "checkout-cleanup"')).toBe(true);
    expect(config.includes('name: "checkout-availability"')).toBe(true);
    expect(config.includes('name: "checkout-plan"')).toBe(true);
    expect(config.includes("dependencies: [...checkoutCaseProjects]")).toBe(
      true
    );
    expect(config.includes("workspaceE2EPlaywrightCheckoutTimeout")).toBe(true);
    expect(config.includes("resolvePlaywrightChromiumExecutable")).toBe(true);
    expect(entry.includes("playwrightEnvironment")).toBe(true);
    expect(entry.includes("...process.env")).toBe(false);
    expect(suite.includes("Effect.forEach")).toBe(false);
    expect(suite.includes("Semaphore")).toBe(false);
    expect(suite.includes("Deferred")).toBe(false);
    expect(
      readTrackedSource(
        resolve(import.meta.dir, "../e2e/playwright-checkout/cleanup.pw.ts")
      ).includes('phaseId: "suite-cleanup"')
    ).toBe(true);
    expect(
      cleanupRuntime.includes("makeWorkspaceE2EProviderVerificationPermitLive")
    ).toBe(false);
    expect(cleanupRuntime.includes("makeWorkspaceE2ECaseRuntimeLive")).toBe(
      false
    );
  });

  test("preserves discount seeding and account phase dependencies", () => {
    const config = readTrackedSource(
      resolve(import.meta.dir, "../playwright.e2e.config.ts")
    );

    expect(
      config.includes(
        'dependencies: ["checkout-setup", "checkout-seed"],\n      name: "checkout-availability",'
      )
    ).toBe(true);
    expect(
      config.includes(
        'dependencies: ["checkout-plan"],\n      name: "account-auth",'
      )
    ).toBe(true);
    expect(
      config.includes(
        'dependencies: ["checkout-setup"],\n      name: "checkout-provider-preparation",'
      )
    ).toBe(true);
    expect(
      config.includes(
        'dependencies: ["checkout-setup"],\n      name: "checkout-invoice-persistence",'
      )
    ).toBe(true);
  });

  test("lets Playwright schedule read-only navigation beside checkout cases", () => {
    const packageJson = readTrackedJson("../package.json") as {
      readonly scripts: Record<string, string>;
    };
    const config = readTrackedSource(
      resolve(import.meta.dir, "../playwright.e2e.config.ts")
    );
    expect(Object.keys(doc.jobs).includes("test-instant-navigation")).toBe(
      false
    );
    expect(rawWorkflow.includes("Run instant navigation E2E")).toBe(false);
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
    expect(config.includes('name: "instant-navigation"')).toBe(true);
    expect(config.includes('testDir: "./e2e/instant-navigation"')).toBe(true);
    expect(config.includes("fullyParallel: true")).toBe(true);
    expect(config.includes("workers: 6")).toBe(true);
    expect(packageJson.scripts["test:instant-navigation"]).toContain(
      "--project=instant-navigation"
    );
  });

  test("lets Playwright write complete GitHub job summaries", () => {
    const config = readTrackedSource(
      resolve(import.meta.dir, "../playwright.e2e.config.ts")
    );

    expect(rawWorkflow.includes("GITHUB_STEP_SUMMARY")).toBe(false);
    expect(config.includes("playwright-github-summary.ts")).toBe(true);
  });
});
