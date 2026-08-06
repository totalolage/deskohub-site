import { WorkspaceAdminApi } from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

export const AdminCliApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "cli",
  (handlers) =>
    handlers.handle("getInfo", () =>
      Effect.succeed({
        apiVersion: "v1" as const,
        service: "deskohub-workspace" as const,
      })
    )
);

const noStore = HttpRouter.middleware(
  (effect) =>
    Effect.map(effect, (response) =>
      HttpServerResponse.setHeader(
        response,
        "Cache-Control",
        "private, no-store"
      )
    ),
  { global: true }
);

const WorkspaceAdminApiLive = Layer.merge(
  HttpApiBuilder.layer(WorkspaceAdminApi).pipe(
    Layer.provide(AdminCliApiHandlers)
  ),
  noStore
).pipe(Layer.provide(NodeHttpServer.layerHttpServices));

export const handleWorkspaceAdminApiRequest = HttpRouter.toWebHandler(
  WorkspaceAdminApiLive,
  { disableLogger: true }
).handler;
