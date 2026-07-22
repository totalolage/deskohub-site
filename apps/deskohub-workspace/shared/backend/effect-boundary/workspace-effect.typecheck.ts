import { Effect, type Layer } from "effect";
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
  // @ts-expect-error Pages must recover their typed failure channel.
  workspace.page({ operation: "type.page" }, () =>
    Effect.fail("handler failed")
  );

  workspace.page(
    // @ts-expect-error Page Layers must be explicitly made infallible.
    { operation: "type.page-layer", layer: fallibleLayer },
    () => responseWithService
  );

  // @ts-expect-error Native actions must recover their typed failure channel.
  workspace.action({ operation: "type.action" }, () =>
    Effect.fail("handler failed")
  );

  // @ts-expect-error Routes must declare disconnect cancellation semantics.
  workspace.route({ operation: "type.route" }, () =>
    Effect.succeed(new Response())
  );

  workspace.route(
    // @ts-expect-error Routes with typed failures require total mapping.
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
