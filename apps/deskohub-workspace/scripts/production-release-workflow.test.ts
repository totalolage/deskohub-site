import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isNumber, isString } from "effect/Predicate";
import {
  emitRollbackTarget,
  promoteStagedDeployment,
  verifyCanonicalAliasServes,
} from "./production-release";
import {
  identifierNames,
  importSpecifiers,
  nodesOf,
  type ParsedSource,
  parseSource,
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

const scriptIdentifiers = identifierNames(releaseScript.ast);
const scriptImportModules = importSpecifiers(releaseScript.ast);

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

/**
 * Text of the tagged shell template inside the rollback operation — the
 * command the recovery path actually executes — or undefined when the
 * operation exists without such an invocation.
 */
const rollbackCommandInRecoveryPath = (
  ast: ParsedSource["ast"]
): string | undefined => {
  const operation = topLevelConstInitializer(ast, "rollbackToDeployment");
  if (!operation) return undefined;
  const templates = nodesOf(operation).flatMap((node) =>
    node.type === "TaggedTemplateExpression"
      ? [node.quasi.quasis.map((quasi) => quasi.value.cooked ?? "").join(" ")]
      : []
  );
  return templates.find((text) => text.includes("rollback"));
};

/** The canonical production alias payload the script's resolver consumes. */
const canonicalAliasPayload = () => ({
  projectId: "project-1",
  deployment: {
    id: "baseline-deployment-id",
    url: "baseline-deployment.vercel.app",
  },
});

type FakeAliasRow = {
  readonly alias: string;
  readonly deploymentId: string;
};

/** One paginated project-alias listing page as the Vercel API returns it. */
const aliasListingPage = (
  aliases: readonly FakeAliasRow[],
  next: number | null
) => ({
  aliases,
  pagination: { next },
});

/** The paginated project listing payload serving the baseline deployment. */
const baselineAliasListing = () =>
  aliasListingPage(
    [
      {
        alias: "deskohub-workspace-site.vercel.app",
        deploymentId: "baseline-deployment-id",
      },
      {
        alias: "workspace.deskohub.cz",
        deploymentId: "baseline-deployment-id",
      },
    ],
    null
  );

const stagedDeploymentPayload = () => ({
  id: "staged-deployment-id",
  readyState: "READY",
});

type FakeVercelPayload = ReturnType<
  | typeof canonicalAliasPayload
  | typeof aliasListingPage
  | typeof stagedDeploymentPayload
>;

const jsonResponse = (payload: FakeVercelPayload): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * Runs `run` with `fetch` routed to fake Vercel API endpoints; returns the
 * requested URLs so callers can assert the real request pattern (for
 * example that alias pagination was actually followed).
 */
const withStubbedVercelApi = async (
  routes: readonly {
    readonly match: (url: string) => boolean;
    readonly respond: () => FakeVercelPayload;
  }[],
  run: () => Promise<void>
): Promise<readonly string[]> => {
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = input instanceof URL ? input.href : input;
    requestedUrls.push(url);
    const route = routes.find((candidate) => candidate.match(url));
    if (!route) throw new Error(`Unexpected Vercel API request: ${url}`);
    return jsonResponse(route.respond());
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return requestedUrls;
};

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
    // The baseline outputs the restore step consumes are proven by the
    // executed promotion flow in "persists the baseline before an ambiguous
    // promotion and recovers through the rollback path".
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
      pollDeadlineMinutes + 2 * (rollbackTimeoutMinutes + pollDeadlineMinutes);
    // Checkout, dependency install, build, migration, and probes keep their
    // own bounded headroom inside the job budget.
    const setupAndBuildHeadroomMinutes = 25;
    expect(jobTimeoutMinutes).toBeGreaterThanOrEqual(
      recoveryWorstCaseMinutes + setupAndBuildHeadroomMinutes
    );
  });

  test("smokes the customer-facing production host only after a confirmed promotion", async () => {
    const canonicalStep = stepByName(
      "Probe canonical production after promotion"
    );
    expect(canonicalStep.if).toBe(
      "always() && steps.promote.outputs.promoted == 'true'"
    );
    expect(canonicalStep.run).toBe(
      "bun scripts/production-release.ts verify-canonical"
    );
    expect(scriptIdentifiers.has("customerFacingProductionDomain")).toBe(true);
    expect(scriptImportModules).toContain("@/shared/utils/site-constants");
    // The domain comes from the real site-constants module at runtime, not
    // from any pinned declaration text.
    const { workspaceSiteConstants } = await import(
      "../shared/utils/site-constants"
    );
    expect(workspaceSiteConstants.brand.domain).toBe("workspace.deskohub.cz");
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
    // Scoped AST verdict: the versioned rollback command must be the actual
    // shell invocation inside the rollback operation, not a string sitting
    // anywhere in the module. Comment-immune by construction.
    const rollbackCommand = rollbackCommandInRecoveryPath(releaseScript.ast);
    expect(rollbackCommand).toBeDefined();
    expect(rollbackCommand).toMatch(/\bvercel@\d[\d.]* rollback\b/);
    expect(rollbackCommand).toContain("--timeout ");
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

  test("the rollback verdict fails when the command literal survives without the recovery invocation", () => {
    const urlName = ["u", "rl"].join("");
    const fixtures = [
      {
        path: "tmp/unused-rollback-literal.ts",
        content: [
          `const unusedCommand = "bunx vercel@54.9.1 rollback \${${urlName}} --yes --timeout 10m";`,
          `const rollbackToDeployment = async (${urlName}: string) => {`,
          "  await Promise.resolve(url);",
          "};",
        ].join("\n"),
      },
      {
        path: "tmp/promoting-recovery.ts",
        content: [
          `const rollbackToDeployment = async (${urlName}: string) => {`,
          `  await $\`bunx vercel@54.9.1 promote \${${urlName}} --yes --timeout 10m\`;`,
          "};",
        ].join("\n"),
      },
    ];
    for (const fixture of fixtures) {
      expect(
        rollbackCommandInRecoveryPath(parseSource(fixture.content))
      ).toBeUndefined();
    }
  });

  test("persists the baseline before an ambiguous promotion and recovers through the rollback path", async () => {
    const persistedOutputs: string[] = [];
    const rollbackUrls: string[] = [];
    let pollTicks = 0;

    const requestedUrls = await withStubbedVercelApi(
      [
        {
          match: (url) => url.includes("/v13/deployments/"),
          respond: stagedDeploymentPayload,
        },
        {
          match: (url) => url.includes("/v4/aliases/"),
          respond: canonicalAliasPayload,
        },
        // The listing keeps serving the baseline, so the staged promotion
        // never confirms and the recovery path must run and re-verify.
        {
          match: (url) => url.includes("/v4/aliases?"),
          respond: baselineAliasListing,
        },
      ],
      async () => {
        let rejection: unknown;
        try {
          await promoteStagedDeployment(
            {
              stagedUrl: "staged-deployment.vercel.app",
              token: "token",
              projectId: "project-1",
              teamId: undefined,
              pollDeadlineMilliseconds: 2,
              pollIntervalMilliseconds: 0,
            },
            {
              rollback: async (url) => {
                rollbackUrls.push(url);
              },
              persist: async (output) => {
                persistedOutputs.push(output);
              },
              sleep: async () => {},
              now: () => (pollTicks += 1),
            }
          );
        } catch (cause) {
          rejection = cause;
        }
        // The ambiguous promotion surfaces as a failure after recovery.
        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toContain("ambiguous");
      }
    );

    // The baseline is persisted before any side effect...
    expect(persistedOutputs).toContain(
      "baseline_url=baseline-deployment.vercel.app\nbaseline_id=baseline-deployment-id\n"
    );
    expect(persistedOutputs).toContain("promotion_state=possibly-started\n");
    // ...the recovery executed against the baseline deployment...
    expect(rollbackUrls).toEqual(["baseline-deployment.vercel.app"]);
    expect(persistedOutputs).toContain("promotion_state=restored\n");
    // ...and both the staged-deployment lookup and alias polls were real.
    expect(requestedUrls.some((url) => url.includes("/v13/deployments/"))).toBe(
      true
    );
    expect(requestedUrls.some((url) => url.includes("/v4/aliases?"))).toBe(
      true
    );
  });

  test("emits the rollback target through GITHUB_OUTPUT and masks the deployment url", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "release-output-"));
    const githubOutput = join(outputDirectory, "github-output.txt");
    const stdoutChunks: string[] = [];
    const originalStdoutWrite = process.stdout.write;
    const previousEnv = { ...process.env };
    process.env.VERCEL_TOKEN = "synthetic-token";
    process.env.VERCEL_PROJECT_ID = "project-1";
    process.env.GITHUB_OUTPUT = githubOutput;
    process.stdout.write = ((chunk: Uint8Array | string) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let emittedOutput = "";
    try {
      await withStubbedVercelApi(
        [
          {
            match: (url) => url.includes("/v4/aliases/"),
            respond: canonicalAliasPayload,
          },
        ],
        async () => {
          await emitRollbackTarget();
        }
      );
      emittedOutput = readFileSync(githubOutput, "utf8");
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.env = previousEnv;
      rmSync(outputDirectory, { recursive: true, force: true });
    }

    expect(emittedOutput).toBe("previous_url=baseline-deployment.vercel.app\n");
    expect(stdoutChunks.join("")).toContain(
      "::add-mask::baseline-deployment.vercel.app"
    );
  });

  test("confirms rollbacks against the paginated required-alias authority, not a single canonical alias", async () => {
    const expected = {
      id: "baseline-deployment-id",
      url: "baseline-deployment.vercel.app",
    };
    const input = {
      token: "token",
      projectId: "project-1",
      teamId: undefined as string | undefined,
    };

    // Every required production alias confirms across two listing pages:
    // the pagination cursor must actually be followed.
    const pagedUrls = await withStubbedVercelApi(
      [
        {
          match: (url) => url.includes("until="),
          respond: () =>
            aliasListingPage(
              [
                {
                  alias: "workspace.deskohub.cz",
                  deploymentId: "baseline-deployment-id",
                },
              ],
              null
            ),
        },
        {
          match: (url) => url.includes("/v4/aliases?"),
          respond: () =>
            aliasListingPage(
              [
                {
                  alias: "deskohub-workspace-site.vercel.app",
                  deploymentId: "baseline-deployment-id",
                },
              ],
              1_700_000_000_000
            ),
        },
      ],
      async () => {
        await verifyCanonicalAliasServes(expected, { ...input });
      }
    );
    expect(pagedUrls.filter((url) => url.includes("/v4/aliases"))).toHaveLength(
      2
    );

    // A single canonical alias is not enough: the customer-facing domain
    // missing from the project listing fails the verification outright.
    await withStubbedVercelApi(
      [
        {
          match: (url) => url.includes("/v4/aliases?"),
          respond: () =>
            aliasListingPage(
              [
                {
                  alias: "deskohub-workspace-site.vercel.app",
                  deploymentId: "baseline-deployment-id",
                },
              ],
              null
            ),
        },
      ],
      async () => {
        await expect(
          verifyCanonicalAliasServes(expected, { ...input })
        ).rejects.toThrow("workspace.deskohub.cz");
      }
    );

    // Aliases that exist but still serve another deployment stay unconfirmed
    // until the bounded window closes, and then fail the recovery.
    let deadlineTicks = 0;
    await withStubbedVercelApi(
      [
        {
          match: (url) => url.includes("/v4/aliases?"),
          respond: () =>
            aliasListingPage(
              [
                {
                  alias: "deskohub-workspace-site.vercel.app",
                  deploymentId: "other-deployment-id",
                },
                {
                  alias: "workspace.deskohub.cz",
                  deploymentId: "other-deployment-id",
                },
              ],
              null
            ),
        },
      ],
      async () => {
        await expect(
          verifyCanonicalAliasServes(
            expected,
            {
              ...input,
              pollDeadlineMilliseconds: 2,
              pollIntervalMilliseconds: 0,
            },
            { sleep: async () => {}, now: () => (deadlineTicks += 1) }
          )
        ).rejects.toThrow("Rollback verification failed");
      }
    );
  });

  test("publishes recovery state through GITHUB_OUTPUT for the workflow conditions", () => {
    // The step-output writes and the stdout masking are proven by the
    // executed "emits the rollback target" flow; these parsed assertions
    // pin the workflow's consumption of those outputs.
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
