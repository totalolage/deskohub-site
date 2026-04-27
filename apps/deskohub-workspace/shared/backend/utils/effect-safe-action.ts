import { Duration, Effect, type Layer, Logger, LogLevel, pipe } from "effect";
import type { z } from "zod/v4";
import type { WorkspaceLocale } from "@/features/i18n";
import { formatEffectError } from "@/shared/utils/error-formatting";
import {
  actionClient,
  PublicSafeActionError,
} from "@/shared/utils/safe-action-client";

export function createEffectSafeAction<I, O, E, R>(
  schema: z.ZodSchema<I>,
  handler: (
    input: I,
    context: { locale: WorkspaceLocale }
  ) => Effect.Effect<O, E, R>,
  layers: Layer.Layer<R, never, never>
) {
  return actionClient
    .inputSchema(schema)
    .action(async ({ parsedInput, ctx }) => {
      const program = pipe(
        Effect.gen(function* () {
          yield* Effect.logDebug("Safe action executed", {
            locale: ctx.locale,
            inputKeys:
              parsedInput && typeof parsedInput === "object"
                ? Object.keys(parsedInput)
                : [],
          });

          const result = yield* handler(parsedInput, { locale: ctx.locale });

          yield* Effect.logDebug("Action completed successfully");
          return result;
        }),
        Effect.tapError((error) => Effect.logError("Action failed", error)),
        Effect.withSpan("safeAction", {
          attributes: {
            "action.locale": ctx.locale,
          },
        }),
        Effect.provide(layers),
        Effect.timeout(Duration.seconds(45)),
        Effect.catchTag("TimeoutException", () =>
          Effect.fail(new Error("Request timed out. Please try again."))
        )
      );

      try {
        return await Effect.runPromise(
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
