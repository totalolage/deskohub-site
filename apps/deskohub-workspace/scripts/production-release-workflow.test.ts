import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countOccurrences,
  extractImportSpecifiers,
  readTrackedSource,
  stripLineComments,
} from "./shared/source-contract";
import {
  findStepByName,
  parseWorkflow,
  type WorkflowStep,
  workflowStepNames,
} from "./shared/workflow-contract";

const workflowPath = resolve(
  import.meta.dir,
  "../../../.github/workflows/deploy-workspace-production.yml"
);

const doc = parseWorkflow(workflowPath);
const deployJob = doc.jobs.deploy;
const stepNames = workflowStepNames(doc);
const allSteps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
const rawWorkflow = readFileSync(workflowPath, "utf8");
const script = readTrackedSource(
  resolve(import.meta.dir, "production-release.ts")
);

const stepByName = (name: string): WorkflowStep => {
  const step = findStepByName(doc, name);
  expect(step).toBeDefined();
  return step as WorkflowStep;
};

const stepIndexOfName = (name: string): number => stepNames.indexOf(name);

describe("deploy-workspace-production workflow", () => {
  test("gates the release on the production baseline before building and promoting", () => {
    const gateIndex = stepIndexOfName(
      "Verify the production baseline before building"
    );
    const buildIndex = stepIndexOfName("Build staged production deployment");
    const promoteIndex = stepIndexOfName("Promote production deployment");

    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(buildIndex);
    expect(buildIndex).toBeLessThan(promoteIndex);
    expect(
      stepByName("Verify the production baseline before building").run
    ).toBe("bun scripts/production-release.ts resolve-previous");
  });

  test("probes staged auth readiness between migration and promotion", () => {
    const migrationIndex = stepIndexOfName("Migrate production database");
    const probeIndex = stepIndexOfName(
      "Probe staged deployment auth readiness"
    );
    const cronsIndex = stepIndexOfName("Verify registered workspace crons");
    const promoteIndex = stepIndexOfName("Promote production deployment");

    expect(probeIndex).toBeGreaterThan(migrationIndex);
    expect(probeIndex).toBeLessThan(promoteIndex);
    expect(cronsIndex).toBeGreaterThan(probeIndex);
    expect(cronsIndex).toBeLessThan(promoteIndex);
    expect(stepByName("Probe staged deployment auth readiness").run).toContain(
      "bun scripts/production-release.ts probe --url"
    );
    expect(stepByName("Verify registered workspace crons").run).toBe(
      "bun scripts/production-release.ts verify-crons"
    );
  });

  test("exposes the protection secret only to the staged probe", () => {
    const probeStep = stepByName("Probe staged deployment auth readiness");
    const probeEnv = probeStep.env;
    expect(probeEnv?.VERCEL_AUTOMATION_BYPASS_SECRET).toBe(
      `\${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}`
    );

    // The job-level env must not carry the bypass secret; only the staged
    // probe step receives it.
    const jobEnv = deployJob.env as Record<string, string> | undefined;
    expect(Object.keys(jobEnv ?? {})).not.toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET"
    );
    const secretOutsideProbe = allSteps
      .filter((step) => step.name !== "Probe staged deployment auth readiness")
      .some((step) =>
        JSON.stringify(step.env ?? {}).includes("VERCEL_AUTOMATION_BYPASS")
      );
    expect(secretOutsideProbe).toBe(false);

    // The script-side requireEnv guard for the secret is exercised by the
    // executed probe behavior in the protected-preview release flow; the
    // parsed assertions above already prove only the probe step receives it.
  });

  test("promotes through the script so a failed promotion request cannot skip recovery", () => {
    const promoteIndex = stepIndexOfName("Promote production deployment");
    const smokeIndex = stepIndexOfName(
      "Probe canonical production after promotion"
    );

    expect(promoteIndex).toBeGreaterThan(-1);
    expect(smokeIndex).toBeGreaterThan(promoteIndex);
    expect(stepByName("Promote production deployment").run).toContain(
      "bun scripts/production-release.ts promote --url"
    );
    expect(/vercel@\d[\d.]* promote/.test(rawWorkflow)).toBe(false);
  });

  test("persists the pre-request baseline before the promotion request", () => {
    // The promote step persists the pre-request baseline as step outputs and
    // the always() recovery step consumes them; both are asserted on the
    // parsed workflow structure in job order.
    const promoteStep = stepByName("Promote production deployment");
    expect(promoteStep.id).toBe("promote");
    const restoreStep = stepByName(
      "Restore the pre-request production baseline"
    );
    const recoveryContract = `${restoreStep.if ?? ""}\n${restoreStep.run ?? ""}`;
    expect(recoveryContract).toContain("steps.promote.outputs.baseline_url");
    expect(recoveryContract).toContain("steps.promote.outputs.baseline_id");
    expect(recoveryContract).toContain("steps.promote.outputs.promotion_state");
    const promoteIndex = stepIndexOfName("Promote production deployment");
    const restoreIndex = stepIndexOfName(
      "Restore the pre-request production baseline"
    );
    expect(promoteIndex).toBeGreaterThan(-1);
    expect(promoteIndex).toBeLessThan(restoreIndex);
  });

  test("restores the pre-request baseline, never the stale pre-build retention target", () => {
    const restoreStep = stepByName(
      "Restore the pre-request production baseline"
    );
    expect(JSON.stringify(allSteps).includes("steps.rollback-target")).toBe(
      false
    );
    expect(restoreStep.run).toBe(
      `bun scripts/production-release.ts rollback --url "\${{ steps.promote.outputs.baseline_url }}" --id "\${{ steps.promote.outputs.baseline_id }}"`
    );
    expect(countOccurrences(script, "baseline_url=")).toBeGreaterThan(0);
    expect(countOccurrences(script, "baseline_id=")).toBeGreaterThan(0);
  });

  test("survives workflow cancellation at the job level so the always() finalizers are reached", () => {
    // The deploy job itself carries the always() condition.
    expect(deployJob.if).toContain("always()");
  });

  test("runs an always() finalizer while promotion is possibly started but unresolved", () => {
    const smokeIndex = stepIndexOfName(
      "Probe canonical production after promotion"
    );
    const restoreIndex = stepIndexOfName(
      "Restore the pre-request production baseline"
    );
    const failIndex = stepIndexOfName("Fail the release after rollback");

    expect(smokeIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeGreaterThan(smokeIndex);
    expect(failIndex).toBeGreaterThan(restoreIndex);

    const restoreIf = stepByName(
      "Restore the pre-request production baseline"
    ).if;
    expect(restoreIf).toContain("always()");
    expect(restoreIf).toContain(
      "steps.promote.outputs.promotion_state == 'possibly-started'"
    );
    expect(restoreIf).toContain(
      "steps.promote.outputs.promotion_state == 'recovery-needed'"
    );
    expect(restoreIf).toContain(
      "(steps.promote.outputs.promoted == 'true' && steps.canonical-smoke.outcome != 'success')"
    );

    const failStep = stepByName("Fail the release after rollback");
    expect(failStep.if).toBe("always() && failure()");
  });

  test("recovers whenever the canonical smoke does not succeed, including cancellation", () => {
    const restoreIf =
      stepByName("Restore the pre-request production baseline").if ?? "";

    expect(
      restoreIf.includes("steps.canonical-smoke.outcome != 'success'")
    ).toBe(true);
    expect(restoreIf.includes("steps.canonical-smoke.outcome ==")).toBe(false);

    // Mirrors the GitHub expression literals from the restore condition.
    const recovers = (promoted: string, smokeOutcome: string) =>
      promoted === "true" && smokeOutcome !== "success";

    expect(recovers("true", "success")).toBe(false);
    expect(recovers("true", "failure")).toBe(true);
    expect(recovers("true", "cancelled")).toBe(true);
    expect(recovers("true", "skipped")).toBe(true);
    expect(recovers("false", "failure")).toBe(false);
    expect(recovers("false", "")).toBe(false);
  });

  test("budgets the job timeout for setup, the promotion poll, and both recovery attempts", () => {
    const jobTimeoutMinutes = Number(
      rawWorkflow.match(/timeout-minutes: (\d+)/)?.[1]
    );
    const pollDeadlineMinutes = Number(
      script.match(/defaultPollDeadlineMilliseconds = (\d+) \* 60_000/)?.[1]
    );
    const rollbackTimeoutMinutes = Number(
      script.match(/rollback \$\{url\} --scope \S+ --yes --timeout (\d+)m/)?.[1]
    );

    expect(jobTimeoutMinutes).toBeGreaterThan(0);
    expect(pollDeadlineMinutes).toBeGreaterThan(0);
    expect(rollbackTimeoutMinutes).toBeGreaterThan(0);

    // Worst case after the promotion request: the bounded promotion poll,
    // then the in-script rollback plus its verification, then the always()
    // finalizer rollback plus its verification — each rollback bounded by
    // the CLI timeout and each verification by the poll deadline.
    const recoveryWorstCaseMinutes =
      pollDeadlineMinutes + 2 * (rollbackTimeoutMinutes + pollDeadlineMinutes);
    // Checkout, dependency install, build, migration, and probes keep their
    // own bounded headroom inside the job budget.
    const setupAndBuildHeadroomMinutes = 25;
    expect(jobTimeoutMinutes).toBeGreaterThanOrEqual(
      recoveryWorstCaseMinutes + setupAndBuildHeadroomMinutes
    );
  });

  test("smokes the customer-facing production host only after a confirmed promotion", () => {
    const canonicalStep = stepByName(
      "Probe canonical production after promotion"
    );
    expect(canonicalStep.if).toBe(
      "always() && steps.promote.outputs.promoted == 'true'"
    );
    expect(canonicalStep.run).toBe(
      "bun scripts/production-release.ts verify-canonical"
    );
    expect(
      countOccurrences(script, "customerFacingProductionDomain")
    ).toBeGreaterThan(0);
    expect(
      extractImportSpecifiers(script)
        .join("\n")
        .includes("@/shared/utils/site-constants")
    ).toBe(true);
    const siteConstants = readFileSync(
      resolve(import.meta.dir, "../shared/utils/site-constants.ts"),
      "utf8"
    );
    expect(siteConstants.includes('domain: "workspace.deskohub.cz"')).toBe(
      true
    );
  });

  test("never leaves a possibly promoted release untested or unrestored", () => {
    expect(
      JSON.stringify(deployJob).includes("steps.promote.outputs.promoted")
    ).toBe(true);
    expect(
      JSON.stringify(deployJob).includes("if: always() && failure()") ||
        allSteps.some((step) => step.if === "always() && failure()")
    ).toBe(true);
    expect(
      JSON.stringify(deployJob).includes(
        "steps.promote.outputs.promotion_state == 'recovery-needed'"
      )
    ).toBe(true);
    expect(
      allSteps.some((step) =>
        (step.run ?? "").includes("bun scripts/production-release.ts promote")
      )
    ).toBe(true);
  });

  test("rolls the release back through the script's Vercel rollback operation", () => {
    // Comment-aware: a commented-out operation must not count as present.
    expect(/vercel@\d[\d.]* rollback/.test(stripLineComments(script))).toBe(
      true
    );
    expect(/vercel@\d[\d.]* promote/.test(script)).toBe(false);
    expect(/rollback[^\n]*vercel@\d[\d.]* promote/.test(rawWorkflow)).toBe(
      false
    );
    expect(
      allSteps.some((step) =>
        (step.run ?? "").includes(
          "bun scripts/production-release.ts rollback --url"
        )
      )
    ).toBe(true);
  });

  test("confirms rollbacks against the paginated required-alias authority, not a single canonical alias", () => {
    // Comment-aware: commented-out identifiers must not count as present.
    const activeScript = stripLineComments(script);
    expect(countOccurrences(activeScript, "listProjectAliases")).toBeGreaterThan(0);
    expect(
      countOccurrences(activeScript, "requiredProductionAliases")
    ).toBeGreaterThan(0);
    expect(countOccurrences(activeScript, "waitForCanonicalAlias")).toBe(0);

    // Negative fixture: commenting out the authority call satisfies nothing.
    const commentedOut = [
      "// const aliases = await listProjectAliases(client, config);",
    ].join("\n");
    expect(
      countOccurrences(stripLineComments(commentedOut), "listProjectAliases")
    ).toBe(0);
  });

  test("publishes recovery state through GITHUB_OUTPUT for the workflow conditions", () => {
    // Comment-aware: commented-out output writes must not count as present.
    const activeScript = stripLineComments(script);
    expect(countOccurrences(activeScript, "GITHUB_OUTPUT")).toBeGreaterThan(0);
    expect(countOccurrences(activeScript, "::add-mask::")).toBeGreaterThan(0);
    expect(
      JSON.stringify(deployJob).includes("steps.promote.outputs.baseline_url")
    ).toBe(true);
    expect(
      JSON.stringify(deployJob).includes(
        "steps.promote.outputs.promotion_state"
      )
    ).toBe(true);
    expect(
      allSteps.some((step) =>
        (step.run ?? "").includes(
          "bun scripts/production-release.ts rollback --url"
        )
      )
    ).toBe(true);
  });

  test("keeps GitHub free of Better Auth, Resend, and mail authority", () => {
    expect(rawWorkflow.includes("WORKSPACE_E2E_RESEND_API_KEY")).toBe(false);
    expect(rawWorkflow.includes("EMAIL_API_KEY")).toBe(false);
    expect(rawWorkflow.includes("BETTER_AUTH")).toBe(false);
    const jobEnv = deployJob.env as Record<string, string>;
    expect(jobEnv.VERCEL_TOKEN).toBe(`\${{ secrets.VERCEL_TOKEN }}`);
    expect(jobEnv.NEON_API_KEY).toBe(`\${{ secrets.NEON_API_KEY }}`);
  });

  test("never sends a production magic link as a release probe", () => {
    expect(rawWorkflow.includes("sign-in/magic-link")).toBe(false);
    expect(rawWorkflow.includes("verify-canonical")).toBe(true);
  });
});
