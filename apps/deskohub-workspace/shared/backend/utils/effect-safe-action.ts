import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Duration, Effect, type Layer, Logger, LogLevel } from "effect";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import { formatEffectError } from "@/shared/utils/error-formatting";
import {
  actionClient,
  PublicSafeActionError,
} from "@/shared/utils/safe-action-client";

type ParsedInput<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

export function createEffectSafeAction<S extends StandardSchemaV1, O, E, R>(
  schema: S,
  handler: (
    input: ParsedInput<S>,
    context: { locale: Locale }
  ) => Effect.Effect<O, E, R>,
  layers: Layer.Layer<R, never, never>
) {
  return actionClient
    .inputSchema(schema)
    .action(async ({ parsedInput, ctx }) => {
      const program = Effect.gen(function* () {
        yield* Effect.logDebug("Safe action executed", {
          locale: ctx.locale,
          inputKeys:
            parsedInput && typeof parsedInput === "object"
              ? Object.keys(parsedInput)
              : [],
        });

        const result = yield* handler(parsedInput, {
          locale: ctx.locale,
        });

        yield* Effect.logDebug("Action completed successfully");
        return result;
      }).pipe(
        Effect.tapError((error) => Effect.logError("Action failed", error)),
        Effect.withSpan("safeAction", {
          attributes: {
            "action.locale": ctx.locale,
          },
        }),
        Effect.provide(layers),
        Effect.timeoutFail({
          duration: Duration.seconds(45),
          onTimeout: () => new Error("Request timed out. Please try again."),
        })
      );

      try {
        return await runWorkspaceEffect(
          Logger.withMinimumLogLevel(program, LogLevel.All)
        );
      } catch (error: unknown) {
        if (error instanceof PublicSafeActionError) {
          throw error;
        }

        const formatted = formatEffectError(error);
        throw new Error(formatted.code || "INTERNAL_ACTION_ERROR");
      }
    });
}
