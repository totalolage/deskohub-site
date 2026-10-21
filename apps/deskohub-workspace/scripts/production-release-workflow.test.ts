import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isNumber, isString } from "effect/Predicate";
import {
  nodesOf,
  parseTrackedSource,
  topLevelConstInitializer,
} from "./shared/source-ast";
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
const releaseScript = parseTrackedSource(
  resolve(import.meta.dir, "production-release.ts")
);

/** Text of every template quasi and string literal in the release script. */
const scriptTexts = (): readonly string[] =>
  nodesOf(releaseScript.ast).flatMap((node) => {
    if (node.type === "Literal") {
      return isString(node.value) ? [node.value] : [];
    }
    if (node.type === "TemplateLiteral") {
      // Both the full static text (quasis joined) and each segment: an
      // interpolation may separate the markers a contract pins together.
      const joined = node.quasis
        .map((quasi) => quasi.value.cooked ?? "")
        .join(" ");
      return [joined, ...node.quasis.map((quasi) => quasi.value.cooked ?? "")];
    }
    return [];
  });

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
  });

  test("probes staged auth readiness between migration and promotion", () => {
    const migrationIndex = stepIndexOfName("Migrate production database");
    const probeIndex = stepIndexOfName(
      "Probe staged deployment auth readiness"
    );
    const cronsIndex = stepIndexOfName("Verify staged workspace crons");
    const promoteIndex = stepIndexOfName("Promote production deployment");

    expect(probeIndex).toBeGreaterThan(migrationIndex);
    expect(probeIndex).toBeLessThan(promoteIndex);
    expect(cronsIndex).toBeGreaterThan(probeIndex);
    expect(cronsIndex).toBeLessThan(promoteIndex);
  });

  test("exposes the protection secret only to the staged probe", () => {
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

  test("survives workflow cancellation at the job level so the always() finalizers are reached", () => {
    // The deploy job itself carries the always() condition.
    expect(deployJob.if).toContain("always()");
  });

  test("runs an always() finalizer while promotion is possibly started but unresolved", () => {
    const smokeIndex = stepIndexOfName(
      "Verify canonical production smoke and cron convergence"
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
    expect(restoreIf).toContain("steps.promote.outputs.promoted == 'true' &&");
    expect(restoreIf).toContain("steps.canonical-smoke.outcome != 'success'");
    expect(restoreIf).toContain("cancelled()");

    const failStep = stepByName("Fail the release after rollback");
    expect(failStep.if).toBe("always() && (failure() || cancelled())");
  });

  test("submits published pages to IndexNow only after a successful release, without gating it", () => {
    const indexNowStep = stepByName("Submit published pages to IndexNow");

    // Placed after the recovery steps, a failed or cancelled submission can
    // neither trigger a rollback nor fail the release.
    expect(stepIndexOfName("Submit published pages to IndexNow")).toBe(
      stepNames.length - 1
    );
    expect(indexNowStep.if).toBe("steps.canonical-smoke.outcome == 'success'");
    expect(indexNowStep["continue-on-error"]).toBe(true);
    expect(indexNowStep["timeout-minutes"]).toBeGreaterThan(0);
    expect(indexNowStep.run).toBe("bun scripts/submit-indexnow.ts");
    expect(indexNowStep.env).toBeUndefined();
  });

  test("budgets the job timeout for setup, the promotion poll, and both recovery attempts", () => {
    const jobTimeoutMinutes = Number(
      rawWorkflow.match(/timeout-minutes: (\d+)/)?.[1]
    );
    // The in-script poll deadline is a `minutes * 60_000` initializer in the
    // parsed module; evaluate its numeric operands instead of pinning prose.
    const pollDeadlineInitializer = topLevelConstInitializer(
      releaseScript.ast,
      "defaultPollDeadlineMilliseconds"
    );
    expect(pollDeadlineInitializer).toBeDefined();
    const pollBinary = nodesOf(pollDeadlineInitializer!).find(
      (node) => node.type === "BinaryExpression"
    );
    expect(pollBinary).toBeDefined();
    const pollOperands =
      pollBinary?.type === "BinaryExpression"
        ? [pollBinary.left, pollBinary.right]
        : [];
    expect(pollBinary?.type === "BinaryExpression" && pollBinary.operator).toBe(
      "*"
    );
    const pollFactors = pollOperands.flatMap((operand) =>
      operand.type === "Literal" && isNumber(operand.value)
        ? [operand.value]
        : []
    );
    expect(pollFactors).toContain(60_000);
    const pollDeadlineMinutes = pollFactors.find((factor) => factor !== 60_000);
    expect(pollDeadlineMinutes).toBeGreaterThan(0);
    // Each rollback runs under an explicit CLI timeout spelled in the
    // rollback command template.
    const rollbackCommand = scriptTexts().find(
      (text) => text.includes("rollback ") && text.includes("--timeout ")
    );
    expect(rollbackCommand).toBeDefined();
    const rollbackTimeoutMinutes = Number(
      rollbackCommand?.match(/--timeout (\d+)m/)?.[1]
    );
    expect(rollbackTimeoutMinutes).toBeGreaterThan(0);

    // Worst case after the promotion request: the bounded promotion poll,
    // then the in-script rollback plus its verification, then the always()
    // finalizer rollback plus its verification — each rollback bounded by
    // the CLI timeout and each verification by the poll deadline.
    const recoveryWorstCaseMinutes =
      2 * pollDeadlineMinutes +
      2 * (rollbackTimeoutMinutes + pollDeadlineMinutes);
    // Checkout, dependency install, build, migration, and probes keep their
    // own bounded headroom inside the job budget.
    const setupAndBuildHeadroomMinutes = 25;
    expect(jobTimeoutMinutes).toBeGreaterThanOrEqual(
      recoveryWorstCaseMinutes + setupAndBuildHeadroomMinutes
    );
  });

  test("keeps GitHub free of Better Auth, Resend, and mail authority", () => {
    expect(rawWorkflow.includes("WORKSPACE_E2E_RESEND_API_KEY")).toBe(false);
    expect(rawWorkflow.includes("EMAIL_API_KEY")).toBe(false);
    expect(rawWorkflow.includes("BETTER_AUTH")).toBe(false);
  });

  test("exposes the Neon API key only to the production migration", () => {
    // Dependency install and the Next build run third-party code, so the
    // database-admin credential stays scoped to the one step that uses it.
    const jobEnv = deployJob.env as Record<string, string>;
    expect(Object.keys(jobEnv)).not.toContain("NEON_API_KEY");
    const keyOutsideMigration = allSteps
      .filter((step) => step.name !== "Migrate production database")
      .some((step) => JSON.stringify(step.env ?? {}).includes("NEON_API_KEY"));
    expect(keyOutsideMigration).toBe(false);
  });

  test("never sends a production magic link as a release probe", () => {
    expect(rawWorkflow.includes("sign-in/magic-link")).toBe(false);
  });
});
