import {
  CliAuthenticationRateLimited,
  CliGrantRejected,
  CliServiceUnavailable,
  CliSessionUnauthorized,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";

export const AdminCliApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "cli",
  (handlers) =>
    Effect.gen(function* () {
      const authentication = yield* CliAuthentication;
      const admission = yield* CliAuthenticationAdmission;
      return handlers
        .handle("getInfo", () =>
          Effect.succeed({
            apiVersion: "v1" as const,
            service: "deskohub-workspace" as const,
          })
        )
        .handle("startAuthentication", ({ payload }) =>
          Effect.gen(function* () {
            const allowed =
              yield* admission.isStartAllowed.pipe(mapServiceFailure);
            if (!allowed) {
              return yield* new CliAuthenticationRateLimited({
                message:
                  "Too many CLI authentication requests were started. Try again shortly.",
              });
            }
            return yield* authentication.start(payload).pipe(mapServiceFailure);
          })
        )
        .handle("getAuthenticationStatus", ({ query }) =>
          authentication.status(query.code).pipe(mapServiceFailure)
        )
        .handle("exchangeGrant", ({ payload }) =>
          authentication
            .exchange(payload)
            .pipe(
              Effect.mapError((cause) =>
                cause instanceof CliGrantRejected
                  ? cause
                  : makeServiceUnavailable()
              )
            )
        )
        .handle("getCurrentSession", ({ headers }) =>
          authentication
            .authenticateSession(headers.authorization)
            .pipe(
              Effect.mapError((cause) =>
                cause instanceof CliSessionUnauthorized
                  ? cause
                  : makeServiceUnavailable()
              )
            )
        );
    })
);

const makeServiceUnavailable = () =>
  new CliServiceUnavailable({
    message: "The administration API is temporarily unavailable.",
  });

const mapServiceFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(makeServiceUnavailable));

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
    Layer.provide(AdminCliApiHandlers),
    Layer.provide(CliAuthenticationAdmission.Live),
    Layer.provide(CliAuthentication.LiveWithDependencies)
  ),
  noStore
).pipe(Layer.provide(NodeHttpServer.layerHttpServices));

export const handleWorkspaceAdminApiRequest = HttpRouter.toWebHandler(
  WorkspaceAdminApiLive,
  { disableLogger: true }
).handler;
