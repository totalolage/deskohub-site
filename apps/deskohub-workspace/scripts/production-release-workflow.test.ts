import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/deploy-workspace-production.yml"
);

const readWorkflow = async () => Bun.file(workflowPath).text();

describe("deploy-workspace-production workflow", () => {
  test("retains the previous deployment before building the staged release", async () => {
    const workflow = await readWorkflow();
    const retainIndex = workflow.indexOf(
      "Retain the current production deployment for rollback"
    );
    const buildIndex = workflow.indexOf("Build staged production deployment");
    const promoteIndex = workflow.indexOf("Promote production deployment");

    expect(retainIndex).toBeGreaterThan(-1);
    expect(retainIndex).toBeLessThan(buildIndex);
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

  test("restores the retained deployment when the canonical smoke fails", async () => {
    const workflow = await readWorkflow();
    const smokeIndex = workflow.indexOf(
      "Probe canonical production after promotion"
    );
    const rollbackIndex = workflow.indexOf(
      "Restore the retained production deployment"
    );
    const failIndex = workflow.indexOf("Fail the release after rollback");

    expect(smokeIndex).toBeGreaterThan(-1);
    expect(rollbackIndex).toBeGreaterThan(smokeIndex);
    expect(failIndex).toBeGreaterThan(rollbackIndex);
    expect(workflow).toContain(
      "if: always() && steps.canonical-smoke.outcome == 'failure'"
    );
    expect(workflow).toContain("steps.rollback-target.outputs.previous_url");
    expect(workflow).toContain("bun scripts/production-release.ts rollback");
    expect(workflow).toContain(
      "bun scripts/production-release.ts verify-canonical"
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

  test("never leaves a possibly promoted release untested or unrestored", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain(
      "if: always() && steps.promote.outputs.promoted == 'true'"
    );
    expect(workflow).toContain("if: always() && failure()");
    expect(workflow).toContain("steps.promote.outputs.promoted");
    expect(workflow).toContain("bun scripts/production-release.ts promote");
  });

  test("rolls the release back through the script's Vercel rollback operation", async () => {
    const workflow = await readWorkflow();
    const script = await Bun.file(
      resolve(import.meta.dir, "production-release.ts")
    ).text();

    expect(script).toMatch(/vercel@\d[\d.]* rollback/);
    expect(script).not.toMatch(/vercel@\d[\d.]* promote/);
    expect(workflow).not.toMatch(/rollback[^\n]*vercel@\d[\d.]* promote/);
    expect(workflow).toContain(
      `bun scripts/production-release.ts rollback --url "\${{ steps.rollback-target.outputs.previous_url }}"`
    );
  });

  test("publishes the rollback target through GITHUB_OUTPUT for the rollback condition", async () => {
    const workflow = await readWorkflow();
    const script = await Bun.file(
      resolve(import.meta.dir, "production-release.ts")
    ).text();

    expect(script).toContain("GITHUB_OUTPUT");
    expect(script).toMatch(/previous_url=/);
    expect(script).toContain("::add-mask::");
    expect(workflow).toContain(
      "steps.rollback-target.outputs.previous_url != ''"
    );
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
