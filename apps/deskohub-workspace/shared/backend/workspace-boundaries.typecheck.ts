import { Context, Effect, type Layer, Schema } from "effect";
import { PostResponseTaskService } from "./post-response-task.service";
import * as workspaceAction from "./workspace-action";
import { defineWorkspaceAction } from "./workspace-action";
import * as workspaceEffect from "./workspace-effect";
import { generateWorkspaceLocationMapImage } from "./workspace-location-map";
import type { WorkspaceOperation } from "./workspace-operation";
import * as workspaceRoute from "./workspace-route";
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
  const locationMapImage: Effect.Effect<Buffer, unknown> =
    generateWorkspaceLocationMapImage();
  void locationMapImage;

  defineWorkspaceAction(
    // @ts-expect-error Actions must declare their input schema.
    { operation: "contact.submit" },
    (input) => Effect.succeed(input)
  );

  defineWorkspaceAction(
    {
      operation: "contact.submit",
      schema: Schema.toStandardSchemaV1(Schema.String),
    },
    // @ts-expect-error Action handlers must provide feature capabilities.
    // @effect-diagnostics-next-line missingEffectContext:off
    () => TestService
  );

  defineWorkspaceAction(
    {
      operation: "contact.submit",
      schema: Schema.toStandardSchemaV1(Schema.String),
    },
    () => TestService.pipe(Effect.provide(TestServiceLive))
  );

  defineWorkspaceRoute(
    // @ts-expect-error Routes must declare disconnect cancellation semantics.
    { operation: "workspaceAvailability" },
    () => Effect.succeed(new Response())
  );

  defineWorkspaceRoute(
    {
      operation: "workspaceAvailability",
      cancellation: "continue-after-disconnect",
    },
    // @ts-expect-error Route success values must be Responses.
    () => Effect.succeed("not a response")
  );

  defineWorkspaceRoute(
    {
      operation: "workspaceAvailability",
      cancellation: "continue-after-disconnect",
    },
    // @ts-expect-error Route failures must be mapped to WorkspaceRouteFailure.
    // @effect-diagnostics-next-line missingEffectError:off
    () => Effect.fail("handler failed").pipe(Effect.as(new Response()))
  );

  defineWorkspaceRoute(
    {
      operation: "workspaceAvailability",
      cancellation: "continue-after-disconnect",
    },
    () =>
      Effect.fail("handler failed").pipe(
        Effect.as(new Response()),
        Effect.mapError(mapWorkspaceInternalRouteFailure("Failed"))
      )
  );

  const dynamicOperation = "synthetic.dynamic.operation" as string;
  const operationKey = "operation" as const;
  const schema = Schema.toStandardSchemaV1(Schema.String);
  const runAlias = workspaceEffect.runWorkspaceEffect;
  const defineTaskAlias = workspaceEffect.defineWorkspaceTask;
  const defineActionAlias = workspaceAction.defineWorkspaceAction;
  const defineRouteAlias = workspaceRoute.defineWorkspaceRoute;

  // @ts-expect-error Aliased calls must reject nonliteral operation strings.
  runAlias(dynamicOperation);
  // @ts-expect-error Namespace/member calls must reject dynamic operations.
  workspaceEffect.runWorkspaceEffect(dynamicOperation);
  // @ts-expect-error Task aliases must retain the closed operation contract.
  defineTaskAlias(dynamicOperation, () => Effect.void);
  // @ts-expect-error Nonliteral action options must fail closed.
  defineActionAlias({ operation: dynamicOperation, schema }, Effect.succeed);
  defineActionAlias(
    {
      // @ts-expect-error Computed action options must fail closed.
      [operationKey]: dynamicOperation,
      schema,
    },
    Effect.succeed
  );
  defineRouteAlias(
    {
      // @ts-expect-error Route aliases must reject nonliteral options.
      operation: dynamicOperation,
      cancellation: "continue-after-disconnect",
    },
    () => Effect.succeed(new Response())
  );

  const wrapDynamicTask = (operation: string) =>
    // @ts-expect-error Intermediate wrappers cannot widen task operations.
    workspaceEffect.defineWorkspaceTask(operation, () => Effect.void);
  void wrapDynamicTask;

  Effect.gen(function* () {
    const postResponseTasks = yield* PostResponseTaskService;
    yield* postResponseTasks.run({
      // @ts-expect-error PostResponseTaskService rejects dynamic operations.
      operation: dynamicOperation,
      task: Effect.void,
    });
  });

  const stableOperation: WorkspaceOperation = "telemetry.flush";
  workspaceEffect.defineWorkspaceTask(stableOperation, () => Effect.void);
}
