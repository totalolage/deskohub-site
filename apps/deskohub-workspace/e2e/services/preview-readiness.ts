import { Context, Effect, Layer } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import { assertPreviewEndpointReady } from "../preview-readiness";

interface IWorkspaceE2EPreviewReadinessService {
  readonly assertWebhookEndpoints: (
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
        assertWebhookEndpoints: (config) =>
          Effect.gen(function* () {
            yield* assertPreviewEndpointReady(
              config,
              "/api/webhooks/nexi"
            );
            yield* assertPreviewEndpointReady(
              config,
              "/api/webhooks/resend"
            );
          }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
      };
    })
  );
}
