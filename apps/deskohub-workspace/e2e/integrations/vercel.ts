import { Data, Effect, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  type WorkspaceE2EDiagnosticCode,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";

const maxVercelResponseBytes = 2 * 1024 * 1024;

/** The default bound of one Vercel API request. */
export const vercelRequestTimeoutMs = 30_000;

/**
 * One caller of the Vercel API: its token, and the diagnostic code its
 * failures carry, so a suite reports provider failures in its own terms.
 */
export type VercelApiAccess = {
  readonly vercelToken: string;
  readonly diagnosticCode?: WorkspaceE2EDiagnosticCode;
};

type VercelFailureReporting = Pick<VercelApiAccess, "diagnosticCode">;

const vercelRequestFailure = (
  access: VercelFailureReporting,
  operation: string,
  reason: string,
  status?: number
) =>
  workspaceE2EError(
    `${operation} failed (${status === undefined ? reason : `HTTP ${status}`})`,
    { diagnosticCode: access.diagnosticCode, operation }
  );

// Read-only requests may be repeated within the caller's deadline when the
// provider reports a transient failure. Permission, not-found, and payload
// failures stay terminal.
export class TransientVercelRequestFailure extends Data.TaggedError(
  "TransientVercelRequestFailure"
)<{
  readonly failure: WorkspaceE2EError;
  readonly timedOut: boolean;
}> {}

const transientVercelStatuses: ReadonlySet<number> = new Set([
  408, 429, 500, 502, 503, 504,
]);

export const transientVercelRequestFailure = (
  access: VercelFailureReporting,
  operation: string,
  reason: string,
  status?: number
) =>
  new TransientVercelRequestFailure({
    failure: vercelRequestFailure(access, operation, reason, status),
    timedOut: reason === "timeout",
  });

/** A bearer-authenticated GET whose transient failures are retryable. */
export const requestVercel = Effect.fn("vercel.request")(function* (
  access: VercelApiAccess,
  url: URL,
  operation: string,
  timeoutMs: number
) {
  const httpClient = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeaders({
      Accept: "application/json",
      Authorization: `Bearer ${access.vercelToken}`,
    })
  );
  const response = yield* httpClient.execute(request).pipe(
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    Effect.mapError(() =>
      transientVercelRequestFailure(access, operation, "request-failed")
    ),
    Effect.timeoutOrElse({
      duration: `${timeoutMs} millis`,
      orElse: () =>
        Effect.fail(
          transientVercelRequestFailure(access, operation, "timeout")
        ),
    })
  );
  yield* Effect.annotateCurrentSpan("vercel.http.status_code", response.status);
  if (transientVercelStatuses.has(response.status)) {
    return yield* transientVercelRequestFailure(
      access,
      operation,
      "request-failed",
      response.status
    );
  }
  if (response.status < 200 || response.status >= 300) {
    return yield* vercelRequestFailure(
      access,
      operation,
      "request-failed",
      response.status
    );
  }
  return response;
});

/** Reads a bounded JSON body; anything larger or malformed is invalid. */
export const readVercelJson = Effect.fn("vercel.readJson")(function* (
  response: Effect.Success<ReturnType<typeof requestVercel>>,
  invalidPayload: () => WorkspaceE2EError
) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  yield* Stream.runForEach(response.stream, (chunk) => {
    if (size + chunk.byteLength > maxVercelResponseBytes) {
      return Effect.fail(invalidPayload());
    }
    size += chunk.byteLength;
    chunks.push(chunk);
    return Effect.void;
  }).pipe(Effect.mapError(invalidPayload));

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return yield* Effect.try({
    catch: invalidPayload,
    try: () => JSON.parse(new TextDecoder().decode(bytes)),
  });
});

/** The deployment behind a preview host, as the Vercel API records it. */
export type VercelDeployment = {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string;
  /** `READY` once the deployment serves traffic. */
  readonly readyState: string | undefined;
  /** `null` for a Preview, `production` or a custom environment's name. */
  readonly target: string | null | undefined;
  /** The commit Vercel built, for Git-connected deployments. */
  readonly githubCommitSha: string | undefined;
};

export const decodeVercelDeployment = (
  payload: unknown,
  expectedProjectId: string
):
  | { readonly kind: "match"; readonly deployment: VercelDeployment }
  | { readonly kind: "invalid" }
  | { readonly kind: "project-mismatch" } => {
  const candidate = payload as {
    id?: unknown;
    meta?: { githubCommitSha?: unknown } | null;
    ownerId?: unknown;
    projectId?: unknown;
    readyState?: unknown;
    target?: unknown;
  } | null;
  if (
    typeof candidate?.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.ownerId !== "string" ||
    candidate.ownerId.length === 0
  ) {
    return { kind: "invalid" };
  }
  if (candidate.projectId !== expectedProjectId) {
    return { kind: "project-mismatch" };
  }
  const { githubCommitSha } = candidate.meta ?? {};
  return {
    deployment: {
      githubCommitSha:
        typeof githubCommitSha === "string" ? githubCommitSha : undefined,
      id: candidate.id,
      ownerId: candidate.ownerId,
      projectId: candidate.projectId,
      readyState:
        typeof candidate.readyState === "string"
          ? candidate.readyState
          : undefined,
      target:
        candidate.target === null || typeof candidate.target === "string"
          ? candidate.target
          : undefined,
    },
    kind: "match",
  };
};

const resolveDeploymentOperation = "resolve Vercel preview deployment";

/**
 * Reads the deployment behind the immutable preview host and fails unless it
 * belongs to the configured Vercel project.
 */
export const resolveVercelDeployment = Effect.fn("vercel.resolveDeployment")(
  function* (
    access: VercelApiAccess & {
      readonly expectedHost: string;
      readonly vercelProjectId: string;
    },
    timeoutMs: number = vercelRequestTimeoutMs
  ): Effect.fn.Return<
    VercelDeployment,
    WorkspaceE2EError | TransientVercelRequestFailure,
    HttpClient.HttpClient
  > {
    const invalidPayload = () =>
      workspaceE2EError("Vercel preview deployment metadata was invalid", {
        diagnosticCode: access.diagnosticCode,
        operation: resolveDeploymentOperation,
      });
    const url = new URL(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(access.expectedHost)}`
    );
    const response = yield* requestVercel(
      access,
      url,
      resolveDeploymentOperation,
      timeoutMs
    );
    const payload = yield* readVercelJson(response, invalidPayload);
    const decoded = decodeVercelDeployment(payload, access.vercelProjectId);
    if (decoded.kind === "invalid") return yield* invalidPayload();
    if (decoded.kind === "project-mismatch") {
      return yield* workspaceE2EError(
        "Vercel preview deployment did not match the configured project",
        {
          diagnosticCode: access.diagnosticCode,
          operation: resolveDeploymentOperation,
        }
      );
    }
    return decoded.deployment;
  },
  (effect, access, timeoutMs = vercelRequestTimeoutMs) =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: `${timeoutMs} millis`,
        orElse: () =>
          Effect.fail(
            transientVercelRequestFailure(
              access,
              resolveDeploymentOperation,
              "timeout"
            )
          ),
      })
    )
);
