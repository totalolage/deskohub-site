import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { toWorkspaceE2EError, workspaceE2EError } from "../errors";

export type AgentEvalTargetExpectation = {
  readonly vercelProjectId: string;
  /** The commit the preview must be built from, when the operator pins one. */
  readonly sha?: string;
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
 * it. Agents book and pay, so only a ready Preview deployment of the
 * Workspace project qualifies: production (and any other named target) is
 * refused even though its immutable URL looks like a preview's.
 */
export const assessAgentEvalDeployment = (
  payload: unknown,
  expected: AgentEvalTargetExpectation
): AgentEvalTargetAssessment => {
  if (payload === null || typeof payload !== "object") {
    return refused("Vercel returned no deployment record");
  }
  const deployment = payload as {
    readonly meta?: { readonly githubCommitSha?: unknown };
    readonly projectId?: unknown;
    readonly readyState?: unknown;
    readonly target?: unknown;
  };
  if (deployment.target !== null && deployment.target !== "preview") {
    return refused(
      deployment.target === "production"
        ? "The target is a production deployment; agent evals run only against previews"
        : "The target is not a preview deployment"
    );
  }
  if (deployment.projectId !== expected.vercelProjectId) {
    return refused("The target belongs to another Vercel project");
  }
  if (deployment.readyState !== "READY") {
    return refused("The preview deployment is not ready");
  }
  if (
    expected.sha !== undefined &&
    deployment.meta?.githubCommitSha !== expected.sha
  ) {
    return refused("The preview was not built from TARGET_SHA");
  }
  return { kind: "preview" };
};

/**
 * Reads the deployment behind the immutable base URL from the Vercel API and
 * fails unless it is a ready Workspace preview.
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
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient
      .execute(
        HttpClientRequest.get(
          `https://api.vercel.com/v13/deployments/${encodeURIComponent(expectedHost)}`
        ).pipe(HttpClientRequest.bearerToken(vercelToken))
      )
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError("read the agent eval target deployment", cause)
        )
      );
    if (response.status !== 200) {
      return yield* workspaceE2EError(
        `Vercel answered ${response.status} for the agent eval target deployment`,
        { operation: "read the agent eval target deployment" }
      );
    }
    const payload = yield* response.json.pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("decode the agent eval target deployment", cause)
      )
    );
    const assessment = assessAgentEvalDeployment(payload, expectation);
    if (assessment.kind === "refused") {
      return yield* workspaceE2EError(assessment.reason, {
        operation: "verify the agent eval target",
      });
    }
  }
);
