import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { WorkspaceE2EConfig } from "./config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import { makeUrl } from "./urls";

export const assertPreviewEndpointsReady = (
  config: WorkspaceE2EConfig
): Effect.Effect<void, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.all(
    [
      assertPreviewEndpointReady(config, "/api/webhooks/nexi"),
      assertPreviewEndpointReady(config, "/api/webhooks/resend"),
      assertPreviewJpegReady(config, "/workspace-location-map.jpeg"),
    ],
    { concurrency: "unbounded", discard: true }
  );

export const assertPreviewEndpointReady = (
  config: WorkspaceE2EConfig,
  path: string
): Effect.Effect<void, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* requestPreviewEndpoint(config, path);
    yield* Effect.succeed(response).pipe(
      Effect.filterOrFail(
        ({ status }) => status >= 200 && status < 300,
        ({ status }) =>
          workspaceE2EError(
            `${path} preview readiness check failed with ${status}`,
            { operation: `check ${path} preview endpoint` }
          )
      )
    );
  });

export const assertPreviewJpegReady = (
  config: WorkspaceE2EConfig,
  path: string
): Effect.Effect<void, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* requestPreviewEndpoint(config, path);
    const operation = `check ${path} preview JPEG`;

    yield* Effect.succeed(response).pipe(
      Effect.filterOrFail(
        ({ status }) => status >= 200 && status < 300,
        ({ status }) =>
          workspaceE2EError(
            `${path} preview JPEG check failed with ${status}`,
            { operation }
          )
      ),
      Effect.filterOrFail(
        ({ headers }) =>
          headers["content-type"]?.startsWith("image/jpeg") === true,
        ({ headers }) =>
          workspaceE2EError(
            `${path} preview returned ${headers["content-type"] ?? "no content type"} instead of image/jpeg`,
            { operation }
          )
      )
    );

    const body = yield* response.arrayBuffer.pipe(
      Effect.mapError((cause) => toWorkspaceE2EError(operation, cause))
    );
    const bytes = new Uint8Array(body);

    yield* Effect.succeed(bytes).pipe(
      Effect.filterOrFail(
        (value) => value[0] === 0xff && value[1] === 0xd8,
        () =>
          workspaceE2EError(
            `${path} preview did not return a valid JPEG payload`,
            { operation }
          )
      )
    );
  });

const requestPreviewEndpoint = (config: WorkspaceE2EConfig, path: string) =>
  Effect.gen(function* () {
    const url = yield* makeUrl(
      `build ${path} preview readiness URL`,
      path,
      config.baseUrl
    );
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeaders(
        config.bypassSecret
          ? { "x-vercel-protection-bypass": config.bypassSecret }
          : {}
      )
    );

    return yield* httpClient
      .execute(request)
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError(`check ${path} preview endpoint`, cause)
        )
      );
  });
