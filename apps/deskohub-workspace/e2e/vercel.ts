import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type Duration, Effect, Schedule } from "effect";
import type { WorkspaceE2EConfig } from "./config";
import {
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import { assert, log, repoRoot } from "./runtime";
import { makeUrl, setSearchParams } from "./urls";

export const writeVercelProjectLink = (
  config: WorkspaceE2EConfig
): Effect.Effect<void, WorkspaceE2EError> => {
  const file = resolve(repoRoot, ".vercel/project.json");
  return Effect.gen(function* () {
    yield* tryWorkspaceE2EPromise("create Vercel project link directory", () =>
      mkdir(dirname(file), { recursive: true })
    );
    yield* tryWorkspaceE2EPromise("write Vercel project link", () =>
      writeFile(
        file,
        `${JSON.stringify({ orgId: config.vercelTeamId, projectId: config.vercelProjectId }, null, 2)}\n`
      )
    );
  });
};

export const getDeployment = (
  config: WorkspaceE2EConfig,
  previewUrl: string
): Effect.Effect<{ readonly id: string }, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const host = (yield* makeUrl("parse Vercel preview URL", previewUrl)).host;
    const response = yield* vercelFetch(config, `/v13/deployments/${host}`);
    const body = (yield* tryWorkspaceE2EPromise(
      "read Vercel deployment response",
      () => response.json()
    )) as { id?: unknown };
    const id = yield* tryWorkspaceE2ESync(
      "assert Vercel deployment response",
      () => {
        assert(
          typeof body.id === "string",
          "Vercel deployment response did not include id"
        );
        return body.id;
      }
    );
    log(`Fresh Vercel deployment ${id} at ${previewUrl}`);
    return { id };
  });

export const recordAliasPreflight = (
  config: WorkspaceE2EConfig,
  deploymentId: string
): Effect.Effect<boolean, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const response = yield* vercelFetch(
      config,
      `/v13/deployments/${config.alias}`,
      {},
      { allowFailure: true }
    );
    if (!response.ok) {
      log(`${config.alias} currently has no readable deployment target`);
      return true;
    }

    const body = (yield* tryWorkspaceE2EPromise(
      "read Vercel alias preflight response",
      () => response.json()
    )) as { id?: unknown };
    if (body.id === deploymentId) {
      log(`${config.alias} already points at the fresh deployment`);
      return false;
    }

    if (typeof body.id === "string") {
      log(
        `${config.alias} currently points at ${body.id}; it will be left on the fresh deployment for webhook stability`
      );
    }
    return true;
  });

export const assignAlias = (
  config: WorkspaceE2EConfig,
  deploymentId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const response = yield* vercelFetch(
      config,
      `/v2/deployments/${deploymentId}/aliases`,
      {
        body: JSON.stringify({ alias: config.alias }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );
    yield* tryWorkspaceE2ESync("assert Vercel alias assignment", () =>
      assert(response.ok, `Vercel alias assignment failed: ${response.status}`)
    );
    log(`Assigned ${config.aliasUrl} to fresh deployment`);
  });

export const verifyAlias = (
  config: WorkspaceE2EConfig,
  deploymentId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const response = yield* vercelFetch(
      config,
      `/v13/deployments/${config.alias}`
    );
    const body = (yield* tryWorkspaceE2EPromise(
      "read Vercel alias response",
      () => response.json()
    )) as { id?: unknown };
    yield* tryWorkspaceE2ESync("assert Vercel alias target", () =>
      assert(
        body.id === deploymentId,
        `${config.alias} does not point at fresh deployment`
      )
    );
    log("Vercel alias target verified");
  });

export const assertWebhookEndpoint = (
  config: WorkspaceE2EConfig,
  path: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* makeUrl(
      `build ${path} endpoint URL`,
      path,
      config.aliasUrl
    );
    if (config.bypassSecret)
      yield* setSearchParams(url, {
        "x-vercel-protection-bypass": config.bypassSecret,
      });
    const response = yield* tryWorkspaceE2EPromise(
      `check ${path} endpoint`,
      () => fetch(url)
    );
    yield* tryWorkspaceE2ESync(`assert ${path} endpoint`, () =>
      assert(response.ok, `${path} health check failed with ${response.status}`)
    );
  });

const vercelFetch = (
  config: WorkspaceE2EConfig,
  path: string,
  init: RequestInit = {},
  options: { readonly allowFailure?: boolean } = {}
): Effect.Effect<Response, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const separator = path.includes("?") ? "&" : "?";
    const response = yield* tryWorkspaceE2EPromise(
      `call Vercel API ${path}`,
      () =>
        fetch(
          `https://api.vercel.com${path}${separator}teamId=${config.vercelTeamId}`,
          {
            ...init,
            headers: {
              authorization: `Bearer ${config.vercelToken}`,
              ...init.headers,
            },
          }
        )
    );
    if (!response.ok && isTransientVercelApiStatus(response.status)) {
      return yield* Effect.fail(
        workspaceE2EError(
          `Vercel API ${path} failed with transient ${response.status}`,
          {
            cause: {
              _tag: "TransientVercelApiResponse",
              path,
              status: response.status,
            },
            operation: `call Vercel API ${path}`,
          }
        )
      );
    }
    yield* tryWorkspaceE2ESync(`assert Vercel API ${path}`, () =>
      assert(
        response.ok || options.allowFailure,
        `Vercel API ${path} failed with ${response.status}`
      )
    );
    return response;
  }).pipe(Effect.retry(vercelApiRetryPolicy));

const isTransientVercelApiStatus = (status: number) =>
  status === 429 || status >= 500;

const isTransientVercelApiFailure = (
  cause: unknown
): cause is {
  readonly _tag: "TransientVercelApiResponse";
  readonly path: string;
  readonly status: number;
} =>
  Boolean(
    cause &&
      typeof cause === "object" &&
      "_tag" in cause &&
      cause._tag === "TransientVercelApiResponse"
  );

const vercelApiRetryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.while<WorkspaceE2EError, Duration.Duration>(({ input }) =>
    isTransientVercelApiFailure(input.cause)
  ),
  Schedule.both(Schedule.recurs(3))
);
