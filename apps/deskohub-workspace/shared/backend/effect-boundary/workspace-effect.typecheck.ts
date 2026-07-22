import { Effect, type Layer, Schema } from "effect";
import type { WorkspaceEffectFacade } from "./next";
import { WorkspaceRouteFailure } from "./route-failure";

interface TestService {
  readonly value: string;
}

declare const workspace: WorkspaceEffectFacade;
declare const fallibleLayer: Layer.Layer<
  TestService,
  "layer acquisition failed",
  never
>;
declare const responseWithService: Effect.Effect<Response, never, TestService>;

const typecheck = false as boolean;

if (typecheck) {
  // @ts-expect-error Actions must declare their input schema.
  workspace.action({ operation: "type.action" }, ({ parsedInput }) =>
    Effect.succeed(parsedInput)
  );

  workspace.action(
    {
      operation: "type.action-failure",
      schema: Schema.toStandardSchemaV1(Schema.String),
    },
    () => Effect.fail("handler failed")
  );

  // @ts-expect-error Routes must declare disconnect cancellation semantics.
  workspace.route({ operation: "type.route" }, () =>
    Effect.succeed(new Response())
  );

  // @ts-expect-error Routes with typed failures require total mapping.
  workspace.route(
    {
      operation: "type.route-failure",
      cancellation: "continue-after-disconnect",
    },
    () => Effect.fail("handler failed").pipe(Effect.as(new Response()))
  );

  // @ts-expect-error Route success values must be Responses.
  workspace.route(
    {
      operation: "type.route-response",
      cancellation: "continue-after-disconnect",
    },
    () => Effect.succeed("not a response")
  );

  workspace.route(
    {
      operation: "type.route-mapped",
      cancellation: "continue-after-disconnect",
      mapFailure: (cause: string) =>
        new WorkspaceRouteFailure({
          statusCode: 500,
          publicMessage: "Failed",
          cause,
        }),
    },
    () => Effect.fail("handler failed").pipe(Effect.as(new Response()))
  );
}
