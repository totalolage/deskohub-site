import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "./config";
import {
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "./errors";
import { assert } from "./runtime";
import { makeUrl } from "./urls";

export const assertPreviewEndpointReady = (
  config: WorkspaceE2EConfig,
  path: string,
  fetch_: typeof fetch = fetch
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* makeUrl(
      `build ${path} preview readiness URL`,
      path,
      config.baseUrl
    );
    const response = yield* tryWorkspaceE2EPromise(
      `check ${path} preview endpoint`,
      (signal) =>
        fetch_(url, {
          headers: config.bypassSecret
            ? { "x-vercel-protection-bypass": config.bypassSecret }
            : undefined,
          signal,
        })
    );
    yield* tryWorkspaceE2ESync(`assert ${path} preview endpoint`, () =>
      assert(
        response.ok,
        `${path} preview readiness check failed with ${response.status}`
      )
    );
  });
