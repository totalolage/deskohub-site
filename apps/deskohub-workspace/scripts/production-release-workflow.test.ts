import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/deploy-workspace-production.yml"
);

const readWorkflow = async () => Bun.file(workflowPath).text();
const readScript = async () =>
  Bun.file(resolve(import.meta.dir, "production-release.ts")).text();

describe("deploy-workspace-production workflow", () => {
  test("gates the release on the production baseline before building and promoting", async () => {
    const workflow = await readWorkflow();
    const gateIndex = workflow.indexOf(
      "Verify the production baseline before building"
    );
    const buildIndex = workflow.indexOf("Build staged production deployment");
    const promoteIndex = workflow.indexOf("Promote production deployment");

    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(buildIndex);
    expect(buildIndex).toBeLessThan(promoteIndex);
    expect(workflow).toContain(
      "bun scripts/production-release.ts resolve-previous"
    );
  });

  test("probes staged auth readiness between migration and promotion", async () => {
    const workflow = await readWorkflow();
    const migrationIndex = workflow.indexOf("Migrate production database");
    const probeIndex = workflow.indexOf(
      "Probe staged deployment auth readiness"
    );
    const cronsIndex = workflow.indexOf("Verify registered workspace crons");
    const promoteIndex = workflow.indexOf(
      "- name: Promote production deployment"
    );

    expect(probeIndex).toBeGreaterThan(migrationIndex);
    expect(probeIndex).toBeLessThan(promoteIndex);
    expect(cronsIndex).toBeGreaterThan(probeIndex);
    expect(cronsIndex).toBeLessThan(promoteIndex);
    expect(workflow).toContain("bun scripts/production-release.ts probe --url");
    expect(workflow).toContain(
      "bun scripts/production-release.ts verify-crons"
    );
  });

  test("promotes through the script so a failed promotion request cannot skip recovery", async () => {
    const workflow = await readWorkflow();
    const promoteStep = workflow.indexOf("Promote production deployment");
    const smokeStep = workflow.indexOf(
      "Probe canonical production after promotion"
    );

    expect(promoteStep).toBeGreaterThan(-1);
    expect(smokeStep).toBeGreaterThan(promoteStep);
    expect(workflow).toMatch(
      /id: promote\n\s+working-directory: apps\/deskohub-workspace\n\s+run: bun scripts\/production-release\.ts promote --url/
    );
    expect(workflow).not.toMatch(/vercel@\d[\d.]* promote/);
  });

  test("persists the pre-request baseline before the promotion request", async () => {
    const script = await readScript();

    expect(script).toContain("baseline_url=");
    expect(script).toContain("promotion_state=possibly-started");
    expect(script.indexOf("promotion_state=possibly-started")).toBeLessThan(
      script.indexOf("requestPromotion(")
    );
  });

  test("restores the pre-request baseline, never the stale pre-build retention target", async () => {
    const workflow = await readWorkflow();
    const script = await readScript();

    expect(workflow).not.toContain(
      "steps.rollback-target.outputs.previous_url"
    );
    expect(workflow).toContain(
      `bun scripts/production-release.ts rollback --url "\${{ steps.promote.outputs.baseline_url }}"`
    );
    expect(script).toMatch(/baseline_url=/);
  });

  test("runs an always() finalizer while promotion is possibly started but unresolved", async () => {
    const workflow = await readWorkflow();
    const smokeIndex = workflow.indexOf(
      "Probe canonical production after promotion"
    );
    const restoreIndex = workflow.indexOf(
      "Restore the pre-request production baseline"
    );
    const failIndex = workflow.indexOf("Fail the release after rollback");

    expect(smokeIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeGreaterThan(smokeIndex);
    expect(failIndex).toBeGreaterThan(restoreIndex);

    const restoreStep = workflow.slice(restoreIndex, failIndex);
    expect(restoreStep).toContain("if: >-");
    expect(restoreStep).toContain("always()");
    expect(restoreStep).toContain(
      "steps.promote.outputs.promotion_state == 'possibly-started'"
    );
    expect(restoreStep).toContain(
      "steps.promote.outputs.promotion_state == 'recovery-needed'"
    );
    expect(restoreStep).toContain(
      "(steps.promote.outputs.promoted == 'true' && steps.canonical-smoke.outcome == 'failure')"
    );

    const failStep = workflow.slice(failIndex);
    expect(failStep).toContain("if: always() && failure()");
  });

  test("smokes the customer-facing production host only after a confirmed promotion", async () => {
    const workflow = await readWorkflow();
    const script = await readScript();
    const siteConstants = await Bun.file(
      resolve(import.meta.dir, "../shared/utils/site-constants.ts")
    ).text();

    expect(workflow).toContain(
      "if: always() && steps.promote.outputs.promoted == 'true'"
    );
    expect(workflow).toContain(
      "bun scripts/production-release.ts verify-canonical"
    );
    expect(script).toContain("customerFacingProductionDomain");
    expect(script).toContain("@/shared/utils/site-constants");
    expect(siteConstants).toContain('domain: "workspace.deskohub.cz"');
  });

  test("never leaves a possibly promoted release untested or unrestored", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain("steps.promote.outputs.promoted");
    expect(workflow).toContain("if: always() && failure()");
    expect(workflow).toContain(
      "steps.promote.outputs.promotion_state == 'recovery-needed'"
    );
    expect(workflow).toContain("bun scripts/production-release.ts promote");
  });

  test("rolls the release back through the script's Vercel rollback operation", async () => {
    const workflow = await readWorkflow();
    const script = await readScript();

    expect(script).toMatch(/vercel@\d[\d.]* rollback/);
    expect(script).not.toMatch(/vercel@\d[\d.]* promote/);
    expect(workflow).not.toMatch(/rollback[^\n]*vercel@\d[\d.]* promote/);
    expect(workflow).toContain(
      "bun scripts/production-release.ts rollback --url"
    );
  });

  test("publishes recovery state through GITHUB_OUTPUT for the workflow conditions", async () => {
    const workflow = await readWorkflow();
    const script = await readScript();

    expect(script).toContain("GITHUB_OUTPUT");
    expect(script).toContain("::add-mask::");
    expect(workflow).toContain("steps.promote.outputs.baseline_url");
    expect(workflow).toContain("steps.promote.outputs.promotion_state");
    expect(workflow).toContain(
      "bun scripts/production-release.ts rollback --url"
    );
  });

  test("keeps GitHub free of Better Auth, Resend, and mail authority", async () => {
    const workflow = await readWorkflow();

    expect(workflow).not.toContain("WORKSPACE_E2E_RESEND_API_KEY");
    expect(workflow).not.toContain("EMAIL_API_KEY");
    expect(workflow).not.toContain("BETTER_AUTH");
    expect(workflow).toContain(`VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}`);
    expect(workflow).toContain(`NEON_API_KEY: \${{ secrets.NEON_API_KEY }}`);
  });

  test("never sends a production magic link as a release probe", async () => {
    const workflow = await readWorkflow();

    expect(workflow).not.toContain("sign-in/magic-link");
    expect(workflow).toContain("verify-canonical");
  });
});
