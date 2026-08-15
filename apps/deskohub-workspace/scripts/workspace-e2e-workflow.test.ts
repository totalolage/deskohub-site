import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("keeps the atomic allocator isolated from exact-SHA test code", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();

  expect(workflow).not.toContain("  allocate-shard:");
  expect(workflow).toContain(
    "uses: ./.workspace-e2e-coordinator/.github/actions/workspace-e2e-allocation"
  );
  expect(workflow).not.toContain("group: workspace-e2e-shard-allocation");
  expect(workflow).not.toContain("allow_concurrent");
  expect(workflow).toContain("inputs.cleanup_stale_e2e_reservations");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).not.toContain("contents: write");
  expect(workflow).toContain(
    `database-url: \${{ secrets.WORKSPACE_E2E_COORDINATOR_DATABASE_URL }}`
  );
  const runE2EIndex = workflow.indexOf("- name: Run checkout E2E");
  const runE2EStep = workflow.slice(
    runE2EIndex,
    workflow.indexOf("- uses: actions/upload-artifact@v4", runE2EIndex)
  );
  expect(runE2EStep).toContain(
    `WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: \${{ secrets.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL }}`
  );
  expect(runE2EStep).toContain(
    `WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED: "true"`
  );
  expect(runE2EStep).toContain(
    `WORKSPACE_E2E_NEON_API_KEY: \${{ secrets.NEON_API_KEY }}`
  );
  expect(runE2EStep).toContain(
    `WORKSPACE_E2E_NEON_BRANCH_ID: \${{ steps.preview-database.outputs.branch_id }}`
  );
  expect(runE2EStep).toContain(
    `WORKSPACE_E2E_NEON_PROJECT_ID: \${{ env.NEON_PROJECT_ID }}`
  );
  expect(workflow).not.toContain("workspace-e2e-dotypos-sandbox");
  const testJob = workflow.slice(
    workflow.indexOf("  test-e2e:"),
    workflow.indexOf("  publish-final-status:")
  );
  expect(testJob).toContain("contents: read");
  expect(testJob).not.toContain("contents: write");
  expect(testJob).toContain(`release_outcome: \${{ steps.release.outcome }}`);
  expect(testJob).toContain("id: release");
  expect(workflow).toContain(
    `needs.test-e2e.outputs.release_outcome == 'success'`
  );
  expect(workflow).toContain("Workspace E2E shard release failed");
  expect(workflow).toContain("Validate aggregate Dotypos capacity");
  expect(workflow).toContain("Reconcile stale Workspace E2E reservations");
  expect(workflow).toContain("e2e:cleanup-stale --apply");
  const staleCleanupStep = workflow.slice(
    workflow.indexOf("Reconcile stale Workspace E2E reservations"),
    workflow.indexOf("Validate aggregate Dotypos capacity")
  );
  expect(staleCleanupStep).toContain(
    "secrets.WORKSPACE_E2E_DOTYPOS_CLIENT_SECRET"
  );
  expect(staleCleanupStep).not.toContain("secrets.DOTYPOS_CLIENT_SECRET");
  expect(staleCleanupStep).not.toContain(
    "WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL"
  );
  expect(staleCleanupStep).not.toContain(
    "WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED"
  );
  const capacityStep = workflow.slice(
    workflow.indexOf("Validate aggregate Dotypos capacity"),
    workflow.indexOf("Verify hosted browser runtime")
  );
  expect(capacityStep).not.toContain(
    "WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL"
  );
  expect(capacityStep).not.toContain("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED");
  expect(workflow).not.toContain("pulls?state=open");
});

test("binds the manual target origin to a successful exact-SHA Workspace deployment", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();
  const resolveTargetStep = workflow.slice(
    workflow.indexOf("- name: Resolve eligible PR and immutable preview"),
    workflow.indexOf("  test-e2e:")
  );

  expect(workflow).toContain("deployments: read");
  expect(resolveTargetStep).toContain('"repos/$GITHUB_REPOSITORY/deployments"');
  expect(resolveTargetStep).toContain('-f sha="$TARGET_SHA"');
  expect(resolveTargetStep).toContain(
    "-f environment='Preview – deskohub-workspace-site'"
  );
  expect(resolveTargetStep).toContain(
    '"repos/$GITHUB_REPOSITORY/deployments/$deployment_id/statuses"'
  );
  expect(resolveTargetStep).toContain('--arg target "$normalized_url"');
  expect(resolveTargetStep).toContain('.state == "success"');
  expect(resolveTargetStep).toContain(
    "No successful exact-SHA Workspace deployment matches the target URL"
  );
});

test("uses the allocator without a global provider lock", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();
  const testJob = workflow.slice(
    workflow.indexOf("  test-e2e:"),
    workflow.indexOf("  publish-final-status:")
  );

  expect(testJob).not.toContain("concurrency:");
  const targetCheckoutIndex = testJob.indexOf("Checkout exact target");
  const coordinatorCheckoutIndex = testJob.indexOf(
    "Checkout allocation action"
  );
  const leaseIndex = testJob.indexOf("Lease an available date shard");
  const runIndex = testJob.indexOf("Run checkout E2E");
  const releaseIndex = testJob.indexOf("Release date shard");

  expect(targetCheckoutIndex).toBeLessThan(coordinatorCheckoutIndex);
  expect(coordinatorCheckoutIndex).toBeLessThan(leaseIndex);
  expect(leaseIndex).toBeLessThan(runIndex);
  expect(runIndex).toBeLessThan(releaseIndex);
});

test("passes allocated shard and provider coordination through Turborepo", async () => {
  const turbo = await Bun.file(
    resolve(import.meta.dir, "../../../turbo.json")
  ).json();
  const environment = turbo.tasks["test:e2e"].passThroughEnv as string[];

  expect(environment).toContain("WORKSPACE_E2E_ALLOCATION_SHARD");
  expect(environment).toContain("GITHUB_STEP_SUMMARY");
  expect(environment).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
  expect(environment).toContain("WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL");
  expect(environment).toContain("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED");
  expect(environment).toContain("WORKSPACE_E2E_NEON_API_KEY");
  expect(environment).toContain("WORKSPACE_E2E_NEON_BRANCH_ID");
  expect(environment).toContain("WORKSPACE_E2E_NEON_PROJECT_ID");
});

test("pins and verifies the Auth webhook tunnel client", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();

  expect(workflow).toContain("CLOUDFLARED_VERSION: 2026.7.2");
  expect(workflow).toContain(
    "CLOUDFLARED_SHA256: ec905ea7b7e327ff8abdde8cb64697a2152de74dbcdbf6aec9db8364eb3886cd"
  );
  expect(workflow).toContain("sha256sum --check");
  expect(workflow).toContain("cloudflared --version");
});

test("runs invoice persistence inside the normal exact-SHA Playwright graph", async () => {
  const packageJson = await Bun.file(
    resolve(import.meta.dir, "../package.json")
  ).json();
  const testUnit = packageJson.scripts.test as string;
  const testE2E = packageJson.scripts["test:e2e"] as string;
  const turbo = await Bun.file(
    resolve(import.meta.dir, "../turbo.json")
  ).json();
  const playwrightConfig = await Bun.file(
    resolve(import.meta.dir, "../playwright.e2e.config.ts")
  ).text();
  const invoicePersistenceProject = await Bun.file(
    resolve(
      import.meta.dir,
      "../e2e/playwright-checkout/invoice-persistence.pw.ts"
    )
  ).text();
  const invoicePersistence = await Bun.file(
    resolve(import.meta.dir, "../e2e/integrations/invoice-persistence.ts")
  ).text();
  const databaseContract = await Bun.file(
    resolve(import.meta.dir, "../db/database.service.ts")
  ).text();
  const accountingKeyContract = await Bun.file(
    resolve(
      import.meta.dir,
      "../features/accounting/backend/accounting-snapshot-key.service.ts"
    )
  ).text();

  expect(testE2E).toBe("bun scripts/workspace-e2e.ts");
  expect(packageJson.dependencies["server-only"]).toBe("^0.0.1");
  expect(packageJson.scripts["test:accounting-persistence"]).toBeUndefined();
  expect(testUnit).not.toContain("e2e.test.ts");
  expect(turbo.tasks["test:accounting-persistence"]).toBeUndefined();
  expect(turbo.tasks["test:e2e"]).toBeUndefined();
  expect(playwrightConfig).toContain('name: "checkout-invoice-persistence"');
  expect(playwrightConfig).toContain('"checkout-invoice-persistence"');
  expect(invoicePersistenceProject).toContain("assertInvoicePersistence");
  expect(invoicePersistenceProject).toContain('phaseId: "invoice-persistence"');
  expect(invoicePersistence).toContain("yield* E2EDatabase");
  expect(invoicePersistence).toContain(
    "temporalInstantToIsoString(Temporal.Now.instant())"
  );
  expect(invoicePersistence).toContain(
    'like(invoices.dotyposCustomerId, "synthetic-customer-%")'
  );
  const deliveryCleanup = invoicePersistence.indexOf(
    ".delete(invoiceEmailDeliveries)"
  );
  expect(deliveryCleanup).toBeGreaterThan(-1);
  expect(deliveryCleanup).toBeLessThan(
    invoicePersistence.indexOf(".delete(invoices)")
  );
  expect(invoicePersistence).not.toContain("WORKSPACE_E2E_DATABASE_ALLOWLIST");
  expect(databaseContract).not.toContain('from "@/env"');
  expect(accountingKeyContract).not.toContain('from "@/env"');
  expect(accountingKeyContract).not.toContain('import "server-only"');
});

test("uses Playwright with the hosted runner browser without downloading another browser", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();

  expect(workflow).not.toContain("playwright install --with-deps");
  expect(workflow).toContain("command -v google-chrome");
  expect(workflow).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
  expect(workflow).toContain("Verify hosted browser runtime");
});

test("lets Playwright own checkout preparation, scheduling, and parallelism", async () => {
  const config = await Bun.file(
    resolve(import.meta.dir, "../playwright.e2e.config.ts")
  ).text();
  const entry = await Bun.file(
    resolve(import.meta.dir, "workspace-e2e.ts")
  ).text();
  const suite = await Bun.file(
    resolve(import.meta.dir, "../e2e/suite.ts")
  ).text();
  const cleanupProject = await Bun.file(
    resolve(import.meta.dir, "../e2e/playwright-checkout/cleanup.pw.ts")
  ).text();
  const cleanupRuntime = await Bun.file(
    resolve(
      import.meta.dir,
      "../e2e/playwright-checkout/cleanup-runtime-fixtures.ts"
    )
  ).text();

  expect(entry).toContain("playwright.e2e.config.ts");
  expect(config).toContain("fullyParallel: true");
  expect(config).toContain("maxFailures: 1");
  expect(config).toContain("workers: 6");
  expect(config).toContain('teardown: "checkout-cleanup"');
  expect(config).toContain('name: "checkout-availability"');
  expect(config).toContain('name: "checkout-plan"');
  expect(config).toContain('name: "account"');
  expect(config).toContain('dependencies: ["checkout-payment-1"]');
  expect(config).toContain('testDir: "./e2e/playwright-account"');
  expect(config).toContain("dependencies: [...checkoutCaseProjects]");
  expect(config).toContain("workspaceE2EPlaywrightCheckoutTimeout");
  expect(config).toContain("resolvePlaywrightChromiumExecutable");
  expect(entry).toContain("playwrightEnvironment");
  expect(entry).not.toContain("...process.env");
  expect(suite).not.toContain("Effect.forEach");
  expect(suite).not.toContain("Semaphore");
  expect(suite).not.toContain("Deferred");
  expect(cleanupProject).toContain('phaseId: "suite-cleanup"');
  expect(cleanupRuntime).not.toContain(
    "makeWorkspaceE2EProviderVerificationPermitLive"
  );
  expect(cleanupRuntime).not.toContain("makeWorkspaceE2ECaseRuntimeLive");
});

test("lets Playwright schedule read-only navigation beside checkout cases", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();
  const checkoutJob = workflow.slice(
    workflow.indexOf("  test-e2e:"),
    workflow.indexOf("  publish-final-status:")
  );
  const finalStatusJob = workflow.slice(
    workflow.indexOf("  publish-final-status:")
  );
  const packageJson = await Bun.file(
    resolve(import.meta.dir, "../package.json")
  ).json();
  const config = await Bun.file(
    resolve(import.meta.dir, "../playwright.e2e.config.ts")
  ).text();

  expect(workflow).not.toContain("  test-instant-navigation:");
  expect(workflow).not.toContain("Run instant navigation E2E");
  expect(checkoutJob).toContain("needs: [resolve-target, migrate-preview]");
  expect(checkoutJob).not.toContain("Migrate preview database");
  expect(finalStatusJob).toContain("needs: [resolve-target, test-e2e]");
  expect(config).toContain('name: "instant-navigation"');
  expect(config).toContain('testDir: "./e2e/instant-navigation"');
  expect(config).toContain("fullyParallel: true");
  expect(config).toContain("workers: 6");
  expect(packageJson.scripts["test:instant-navigation"]).toContain(
    "--project=instant-navigation"
  );
});

test("lets Playwright write complete GitHub job summaries", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();
  const config = await Bun.file(
    resolve(import.meta.dir, "../playwright.e2e.config.ts")
  ).text();

  expect(workflow).not.toContain("GITHUB_STEP_SUMMARY");
  expect(config).toContain("playwright-github-summary.ts");
});
