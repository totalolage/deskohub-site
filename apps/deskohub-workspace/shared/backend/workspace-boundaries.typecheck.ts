import { Context, Effect, type Layer, Schema } from "effect";
import { defineWorkspaceAction } from "./workspace-action";
import {
  defineWorkspaceRoute,
  mapWorkspaceInternalRouteFailure,
} from "./workspace-route";

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("WorkspaceBoundaryTypecheckService") {}

declare const TestServiceLive: Layer.Layer<TestService>;

const typecheck = false as boolean;

if (typecheck) {
  defineWorkspaceAction(
    // @ts-expect-error Actions must declare their input schema.
    { operation: "type.action" },
    (input) => Effect.succeed(input)
  );

  defineWorkspaceAction(
    {
      operation: "type.action-service",
      schema: Schema.toStandardSchemaV1(Schema.String),
    },
    // @ts-expect-error Action handlers must provide feature capabilities.
    // @effect-diagnostics-next-line missingEffectContext:off
    () => TestService
  );

  defineWorkspaceAction(
    {
      operation: "type.action-provided",
      schema: Schema.toStandardSchemaV1(Schema.String),
    },
    () => TestService.pipe(Effect.provide(TestServiceLive))
  );

  defineWorkspaceRoute(
    // @ts-expect-error Routes must declare disconnect cancellation semantics.
    { operation: "type.route" },
    () => Effect.succeed(new Response())
  );

  defineWorkspaceRoute(
    {
      operation: "type.route-response",
      cancellation: "continue-after-disconnect",
    },
    // @ts-expect-error Route success values must be Responses.
    () => Effect.succeed("not a response")
  );

  defineWorkspaceRoute(
    {
      operation: "type.route-failure",
      cancellation: "continue-after-disconnect",
    },
    // @ts-expect-error Route failures must be mapped to WorkspaceRouteFailure.
    // @effect-diagnostics-next-line missingEffectError:off
    () => Effect.fail("handler failed").pipe(Effect.as(new Response()))
  );

  defineWorkspaceRoute(
    {
      operation: "type.route-mapped",
      cancellation: "continue-after-disconnect",
    },
    () =>
      Effect.fail("handler failed").pipe(
        Effect.as(new Response()),
        Effect.mapError(mapWorkspaceInternalRouteFailure("Failed"))
      )
  );
}
