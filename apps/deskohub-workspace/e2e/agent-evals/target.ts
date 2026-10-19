import { Effect, Schedule } from "effect";
import { workspaceE2EError } from "../errors";
import {
  resolveVercelDeployment,
  type VercelDeployment,
} from "../integrations/vercel";

export type AgentEvalTargetExpectation = {
  readonly vercelProjectId: string;
  /** The commit the preview must be built from (`TARGET_SHA`). */
  readonly sha: string;
};

/**
 * The verified preview a run set targets, kept with its results. It names
 * the deployment and commit only: no URL, host, or bypass.
 */
export type AgentEvalTarget = {
  readonly deploymentId: string;
  readonly sha: string;
  readonly verifiedAt: string;
};

export type AgentEvalTargetAssessment =
  | { readonly kind: "preview" }
  | { readonly kind: "refused"; readonly reason: string };

const refused = (reason: string): AgentEvalTargetAssessment => ({
  kind: "refused",
  reason,
});

/**
 * Decides from Vercel's deployment record whether agents may run against
 * it. Agents book and pay, so only a ready Preview deployment built from the
 * pinned commit qualifies: production (and any other named target) is
 * refused even though its immutable URL looks like a preview's. The lookup
 * already refused deployments of other projects.
 */
export const assessAgentEvalDeployment = (
  deployment: Pick<
    VercelDeployment,
    "githubCommitSha" | "readyState" | "target"
  >,
  expected: Pick<AgentEvalTargetExpectation, "sha">
): AgentEvalTargetAssessment => {
  if (deployment.target !== null && deployment.target !== "preview") {
    return refused(
      deployment.target === "production"
        ? "The target is a production deployment; agent evals run only against previews"
        : "The target is not a preview deployment"
    );
  }
  if (deployment.readyState !== "READY") {
    return refused("The preview deployment is not ready");
  }
  if (deployment.githubCommitSha !== expected.sha) {
    return refused("The preview was not built from TARGET_SHA");
  }
  return { kind: "preview" };
};

const transientRetries = Schedule.spaced("5 seconds").pipe(
  Schedule.both(Schedule.recurs(2))
);

/**
 * Reads the deployment behind the immutable base URL from the Vercel API and
 * fails unless it is a ready Workspace preview of `TARGET_SHA`. Transient
 * Vercel failures are retried twice.
 */
export const verifyAgentEvalTarget = Effect.fn("verifyAgentEvalTarget")(
  function* ({
    expectedHost,
    expectation,
    vercelToken,
  }: {
    readonly expectedHost: string;
    readonly expectation: AgentEvalTargetExpectation;
    readonly vercelToken: string;
  }) {
    const deployment = yield* resolveVercelDeployment({
      expectedHost,
      vercelProjectId: expectation.vercelProjectId,
      vercelToken,
    }).pipe(
      Effect.retry({
        schedule: transientRetries,
        while: (failure) => failure._tag === "TransientVercelRequestFailure",
      }),
      Effect.catchTag("TransientVercelRequestFailure", ({ failure }) =>
        Effect.fail(failure)
      )
    );
    const assessment = assessAgentEvalDeployment(deployment, expectation);
    if (assessment.kind === "refused") {
      return yield* workspaceE2EError(assessment.reason, {
        operation: "verify the agent eval target",
      });
    }
    return {
      deploymentId: deployment.id,
      sha: expectation.sha,
      verifiedAt: new Date().toISOString(),
    } satisfies AgentEvalTarget;
  }
);
