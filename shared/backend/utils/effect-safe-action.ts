import { Duration, Effect, type Layer, Logger, LogLevel, pipe } from "effect";
import type { z } from "zod";
import type { Locale } from "@/i18n";
import { formatEffectError } from "@/shared/utils/error-formatting";
import { logger } from "@/shared/utils/logger";
import { actionClient } from "@/shared/utils/safe-action-client";

export function createEffectSafeAction<I, O, E, R>(
  schema: z.ZodSchema<I>,
  handler: (input: I, context: { locale: Locale }) => Effect.Effect<O, E, R>,
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
        // Add a global timeout of 45 seconds to ensure the action completes
        // This is shorter than Next.js's default timeout to ensure we get an error
        Effect.timeout(Duration.seconds(45)),
        Effect.catchTag("TimeoutException", () =>
          Effect.fail(new Error("Request timed out. Please try again."))
        )
      );

      // Use simpler logger configuration
      const programWithLogging = Logger.withMinimumLogLevel(
        program,
        LogLevel.All
      );

      try {
        // Run the Effect with a timeout
        const result = await Effect.runPromise(programWithLogging);
        logger.log("Effect action succeeded:", result);
        return result;
      } catch (error: unknown) {
        // Log the full error for debugging
        logger.error("Effect action failed with error:", error);

        // Format the error for the user
        const formatted = formatEffectError(error);
        logger.error("Formatted error:", formatted);

        // Throw an error that next-safe-action will catch
        throw new Error(formatted.message || "An unexpected error occurred");
      }
    });
}
