import {
  type AdminCliInfoType,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Redacted, type Schema } from "effect";
import {
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { DhwConfig } from "../config/dhw-config.service";

interface IWorkspaceAdminApiClient {
  readonly getInfo: Effect.Effect<
    AdminCliInfoType,
    HttpClientError.HttpClientError | Schema.SchemaError
  >;
}

export class WorkspaceAdminApiClient extends Context.Service<
  WorkspaceAdminApiClient,
  IWorkspaceAdminApiClient
>()("WorkspaceAdminApiClient") {
  static Live = Layer.effect(
    this,
    Effect.suspend(() => makeWorkspaceAdminApiClient)
  );
}

const makeWorkspaceAdminApiClient = Effect.gen(function* () {
  const config = yield* DhwConfig;
  const requestHeaders = Object.fromEntries(
    Object.entries(config.requestHeaders).map(([name, value]) => [
      name,
      Redacted.value(value),
    ])
  );
  const client = yield* HttpApiClient.make(WorkspaceAdminApi, {
    baseUrl: config.baseUrl,
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.setHeaders(requestHeaders)
    ),
  });

  return {
    getInfo: Effect.fn("WorkspaceAdminApiClient.getInfo")(() =>
      client.cli.getInfo({})
    )(),
  };
});
