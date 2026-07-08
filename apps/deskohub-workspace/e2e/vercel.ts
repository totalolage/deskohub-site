import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "./config";
import {
  effectifyPromise,
  effectifySync,
  type WorkspaceE2EError,
} from "./errors";
import { assert, log, repoRoot } from "./runtime";
import { makeUrl, setSearchParams } from "./urls";

export const writeVercelProjectLink = (
  config: WorkspaceE2EConfig
): Effect.Effect<void, WorkspaceE2EError> => {
  const file = resolve(repoRoot, ".vercel/project.json");
  return Effect.gen(function* () {
    yield* effectifyPromise("create Vercel project link directory", () =>
      mkdir(dirname(file), { recursive: true })
    );
    yield* effectifyPromise("write Vercel project link", () =>
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
    const body = (yield* effectifyPromise(
      "read Vercel deployment response",
      () => response.json()
    )) as { id?: unknown };
    const id = yield* effectifySync("assert Vercel deployment response", () => {
      assert(
        typeof body.id === "string",
        "Vercel deployment response did not include id"
      );
      return body.id;
    });
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

    const body = (yield* effectifyPromise(
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
    yield* effectifySync("assert Vercel alias assignment", () =>
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
    const body = (yield* effectifyPromise("read Vercel alias response", () =>
      response.json()
    )) as { id?: unknown };
    yield* effectifySync("assert Vercel alias target", () =>
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
    const response = yield* effectifyPromise(`check ${path} endpoint`, () =>
      fetch(url)
    );
    yield* effectifySync(`assert ${path} endpoint`, () =>
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
    const response = yield* effectifyPromise(`call Vercel API ${path}`, () =>
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
    yield* effectifySync(`assert Vercel API ${path}`, () =>
      assert(
        response.ok || options.allowFailure,
        `Vercel API ${path} failed with ${response.status}`
      )
    );
    return response;
  });
