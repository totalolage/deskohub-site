import { EffectAction } from "@deskohub/next-effect/effect-action";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Duration, Effect, type Layer, References } from "effect";
import type { Locale } from "@/features/i18n";
import { runWorkspaceServerActionEffect } from "@/shared/backend/logging/server-action";
import { formatEffectError } from "@/shared/utils/error-formatting";
import {
  actionClient,
  getPublicSafeActionErrorMessage,
  PublicSafeActionError,
} from "@/shared/utils/safe-action-client";

type ParsedInput<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

function mapError(error: unknown) {
  const publicErrorMessage = getPublicSafeActionErrorMessage(error);

  if (publicErrorMessage) {
    return new PublicSafeActionError({
      message: publicErrorMessage,
      cause: error,
    });
  }

  const formatted = formatEffectError(error);
  return new Error(formatted.code || "INTERNAL_ACTION_ERROR");
}

function run<A>(effect: Effect.Effect<A, unknown, never>) {
  return runWorkspaceServerActionEffect(
    Effect.provideService(effect, References.MinimumLogLevel, "All")
  );
}

export function createEffectSafeAction<
  S extends StandardSchemaV1,
  O,
  E,
  R,
  LayerError,
>(
  schema: S,
  handler: (
    input: ParsedInput<S>,
    context: { readonly locale: Locale }
  ) => Effect.Effect<O, E, R>,
  layers: Layer.Layer<R, LayerError, never>
) {
  return EffectAction.fromClient(actionClient, {
    layer: layers,
    mapError,
    run,
  })
    .inputSchema(schema)
    .action(({ parsedInput, ctx }) => {
      const { locale } = ctx;

      return Effect.gen(function* () {
        yield* Effect.logDebug("Safe action executed").pipe(
          Effect.annotateLogs({
            locale,
            input: parsedInput,
          })
        );

        const result = yield* handler(parsedInput, {
          locale,
        });

        yield* Effect.logDebug("Action completed successfully");
        return result;
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError("Action failed").pipe(Effect.annotateLogs({ error }))
        ),
        Effect.withSpan("safeAction", {
          attributes: {
            "action.locale": locale,
          },
        }),
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
    });
}
