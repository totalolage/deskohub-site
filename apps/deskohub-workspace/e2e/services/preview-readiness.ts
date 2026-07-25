import { Context, Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  assertPreviewEndpointReady,
  assertPreviewJpegReady,
} from "../preview-readiness";

interface IWorkspaceE2EPreviewReadinessService {
  readonly assertEndpoints: (
    config: WorkspaceE2EConfig
  ) => Effect.Effect<void, WorkspaceE2EError>;
}

export class WorkspaceE2EPreviewReadinessService extends Context.Service<
  WorkspaceE2EPreviewReadinessService,
  IWorkspaceE2EPreviewReadinessService
>()("WorkspaceE2EPreviewReadinessService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      return {
        assertEndpoints: (config) =>
          Effect.gen(function* () {
            yield* assertPreviewEndpointReady(config, "/api/webhooks/nexi");
            yield* assertPreviewEndpointReady(config, "/api/webhooks/resend");
            yield* assertPreviewJpegReady(
              config,
              "/workspace-location-map.jpeg"
            );
          }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      };
    })
  );
}
