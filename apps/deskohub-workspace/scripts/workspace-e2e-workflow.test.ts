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
  const runE2EStep = workflow.slice(
    workflow.indexOf("- name: Run checkout E2E"),
    workflow.indexOf("- uses: actions/upload-artifact@v4")
  );
  expect(runE2EStep).toContain(
    `WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL: \${{ secrets.WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL }}`
  );
  expect(runE2EStep).toContain(
    `WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED: "true"`
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
    workflow.indexOf("Migrate preview database")
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
  expect(environment).toContain("WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL");
  expect(environment).toContain("WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED");
});

test("runs invoice persistence inside the normal exact-SHA E2E runner", async () => {
  const packageJson = await Bun.file(
    resolve(import.meta.dir, "../package.json")
  ).json();
  const testUnit = packageJson.scripts.test as string;
  const testE2E = packageJson.scripts["test:e2e"] as string;
  const turbo = await Bun.file(
    resolve(import.meta.dir, "../turbo.json")
  ).json();
  const runner = await Bun.file(
    resolve(import.meta.dir, "../e2e/services/runner.ts")
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
  expect(runner).toContain("assertInvoicePersistence");
  expect(runner).toContain('phaseId: "invoice-persistence"');
  expect(invoicePersistence).toContain("yield* E2EDatabase");
  expect(invoicePersistence).toContain(
    "temporalInstantToIsoString(Temporal.Now.instant())"
  );
  expect(invoicePersistence).not.toContain("WORKSPACE_E2E_DATABASE_ALLOWLIST");
  expect(databaseContract).not.toContain('from "@/env"');
  expect(accountingKeyContract).not.toContain('from "@/env"');
  expect(accountingKeyContract).not.toContain('import "server-only"');
});

test("uses the hosted runner browser without downloading another browser", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();

  expect(workflow).not.toContain("agent-browser install --with-deps");
  expect(workflow).toContain("command -v google-chrome");
  expect(workflow).toContain("AGENT_BROWSER_EXECUTABLE_PATH");
  expect(workflow).toContain("Hosted browser verification");
});

test("reports the complete test job setup critical path", async () => {
  const workflow = await Bun.file(
    resolve(import.meta.dir, "../../../.github/workflows/workspace-e2e.yml")
  ).text();
  const testJob = workflow.slice(
    workflow.indexOf("  test-e2e:"),
    workflow.indexOf("  publish-final-status:")
  );
  const setupClockIndex = testJob.indexOf("Start test job setup timing");
  const checkoutIndex = testJob.indexOf("Checkout exact target");
  const postAllocationClockIndex = testJob.indexOf(
    "Start post-allocation setup timing"
  );
  const runIndex = testJob.indexOf("Run checkout E2E");

  expect(setupClockIndex).toBeGreaterThan(-1);
  expect(setupClockIndex).toBeLessThan(checkoutIndex);
  expect(checkoutIndex).toBeLessThan(postAllocationClockIndex);
  expect(postAllocationClockIndex).toBeLessThan(runIndex);
  expect(testJob).toContain("Post-allocation setup critical path");
  expect(testJob).toContain("Total test job setup critical path");
});
