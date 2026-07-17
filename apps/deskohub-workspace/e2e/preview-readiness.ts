import { Effect } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { WorkspaceE2EConfig } from "./config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import { makeUrl } from "./urls";

export const assertPreviewEndpointReady = (
  config: WorkspaceE2EConfig,
  path: string
): Effect.Effect<void, WorkspaceE2EError, HttpClient.HttpClient> =>
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
    const response = yield* httpClient.execute(request).pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError(`check ${path} preview endpoint`, cause)
      )
    );
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
