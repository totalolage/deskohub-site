import { EffectAction } from "@deskohub/next-effect/effect-action";
import { Duration, Effect, type Layer } from "effect";
import type { z } from "zod";
import type { Locale } from "@/features/i18n";
import { formatEffectError } from "@/shared/utils/error-formatting";
import { actionClient } from "@/shared/utils/safe-action-client";

export function createEffectSafeAction<I, O, E, R>(
  schema: z.ZodSchema<I>,
  handler: (input: I, context: { locale: Locale }) => Effect.Effect<O, E, R>,
  layers: Layer.Layer<R, never, never>
) {
  return EffectAction.fromClient(actionClient, {
    layer: layers,
    mapError: (error) => {
      const formatted = formatEffectError(error);

      return new Error(formatted.message || "An unexpected error occurred");
    },
  })
    .inputSchema(schema)
    .action(({ parsedInput, ctx }) =>
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
      }).pipe(
        Effect.tapError((error) => Effect.logError("Action failed", error)),
        Effect.withSpan("safeAction", {
          attributes: {
            "action.locale": ctx.locale,
          },
        }),
        Effect.timeout(Duration.seconds(45)),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(new Error("Request timed out. Please try again."))
        )
      )
    );
}
