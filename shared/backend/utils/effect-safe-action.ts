import { Effect, type Layer, pipe } from "effect";
import type { z } from "zod";
import type { Locale } from "@/i18n";
import { formatEffectError } from "@/shared/utils/error-formatting";
import { actionClient } from "@/shared/utils/safe-action-client";

export function createEffectSafeAction<I, O, E, R>(
  schema: z.ZodSchema<I>,
  handler: (input: I, context: { locale: Locale }) => Effect.Effect<O, E, R>,
  layers: Layer.Layer<R, never, never>
) {
  return actionClient
    .inputSchema(schema)
    .action(async ({ parsedInput, ctx }) => {
      return Effect.runPromise(
        pipe(
          handler(parsedInput, { locale: ctx.locale }),
          Effect.provide(layers),
          Effect.mapError((error) => {
            const formatted = formatEffectError(error);
            throw new Error(formatted.message);
          })
        )
      );
    });
}

// Wrapper for Effect-based actions
export function effectActionClient<O, E>({
  handler,
}: {
  handler: (
    input: unknown
  ) => Promise<{ success: true; data: O } | { success: false; error: E }>;
}) {
  return async (input: unknown) => {
    const result = await handler(input);
    if (!result.success) {
      throw new Error(
        typeof result.error === "object" &&
          result.error !== null &&
          "message" in result.error
          ? String(result.error.message)
          : "Action failed"
      );
    }
    return result.data;
  };
}
