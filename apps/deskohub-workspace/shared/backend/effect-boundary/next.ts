import {
  type EffectBoundaryExecutor,
  NextEffect,
  type NextEffectBoundary,
} from "@deskohub/next-effect";
import {
  EffectAction,
  type EffectActionBoundary,
} from "@deskohub/next-effect/effect-action";
import { Duration, Effect, References } from "effect";
import type { Locale } from "@/features/i18n";
import { formatError } from "@/shared/utils/error-formatting";
import {
  actionClient,
  getPublicSafeActionErrorMessage,
  PublicSafeActionError,
} from "@/shared/utils/safe-action-client";
import { withWorkspaceRequestContext } from "./request-context";
import {
  recoverWorkspaceRouteFailure,
  type WorkspaceRouteErrorResponse,
  type WorkspaceRouteFailure,
} from "./route-failure";

type WorkspaceEffectAction = EffectActionBoundary<
  string,
  "flattened",
  unknown,
  { readonly locale: Locale }
>["action"];

export interface WorkspaceEffectDependencies {
  readonly executor: EffectBoundaryExecutor;
  readonly readActionHeaders: () => Effect.Effect<Headers, never>;
  readonly scheduleTelemetryFlush: () => Effect.Effect<void, never>;
}

export interface WorkspaceEffectFacade
  extends NextEffectBoundary<
    WorkspaceRouteFailure,
    WorkspaceRouteErrorResponse
  > {
  readonly action: WorkspaceEffectAction;
}

export const makeWorkspaceEffect = (
  dependencies: WorkspaceEffectDependencies
): WorkspaceEffectFacade => {
  const next = NextEffect.makeBoundary<
    WorkspaceRouteFailure,
    WorkspaceRouteErrorResponse
  >({
    executor: dependencies.executor,
    route: {
      recoverFailure: recoverWorkspaceRouteFailure,
      withRequest: (request, effect) =>
        Effect.andThen(
          dependencies.scheduleTelemetryFlush(),
          withWorkspaceRequestContext(request.headers, effect)
        ),
    },
  });

  const actions = EffectAction.makeBoundary(actionClient, {
    runExit: dependencies.executor.runExit,
    prepare: ({ args }, effect) => {
      const invocation = dependencies.readActionHeaders().pipe(
        Effect.flatMap((headers) => {
          const logged = Effect.gen(function* () {
            yield* Effect.logDebug("Safe action executed").pipe(
              Effect.annotateLogs({
                locale: args.ctx.locale,
                input: args.parsedInput,
              })
            );
            const result = yield* effect;
            yield* Effect.logDebug("Action completed successfully");
            return result;
          }).pipe(
            Effect.tapError((error) =>
              Effect.logError("Action failed").pipe(
                Effect.annotateLogs({ error })
              )
            ),
            Effect.mapError(mapSafeActionFailure),
            Effect.withSpan("action", {
              attributes: { "action.locale": args.ctx.locale },
            })
          );

          return withWorkspaceRequestContext(headers, logged);
        }),
        Effect.provideService(References.MinimumLogLevel, "All"),
        Effect.timeoutOrElse({
          duration: Duration.seconds(45),
          orElse: () =>
            Effect.fail(
              new PublicSafeActionError({
                message: "Request timed out. Please try again.",
              })
            ),
        })
      );

      return Effect.andThen(dependencies.scheduleTelemetryFlush(), invocation);
    },
  });

  return { ...next, action: actions.action };
};

const mapSafeActionFailure = (error: unknown) => {
  const publicMessage = getPublicSafeActionErrorMessage(error);
  if (publicMessage) {
    return new PublicSafeActionError({ message: publicMessage, cause: error });
  }

  const formatted = formatError(error);
  return new Error(formatted.code || "INTERNAL_ACTION_ERROR", {
    cause: error,
  });
};
