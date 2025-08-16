import { Effect, type Layer, pipe } from "effect";
import type { z } from "zod";
import type { Locale } from "@/i18n";
import { actionClient } from "@/shared/utils/safe-action-client";
import { formatBackendError } from "./effect-action";

export function createEffectSafeAction<I, O, E, R>(
  schema: z.ZodSchema<I>,
  handler: (input: I, context: { locale: Locale }) => Effect.Effect<O, E, R>,
  layers: Layer.Layer<R, never, never>
) {
  return actionClient
    .inputSchema(schema)
    .action(async ({ parsedInput, ctx }) => {
      const program = pipe(
        handler(parsedInput, { locale: ctx.locale }),
        Effect.provide(layers),
        Effect.match({
          onFailure: (error) => ({
            success: false as const,
            error: formatBackendError(error),
          }),
          onSuccess: (data) => ({
            success: true as const,
            data,
          }),
        })
      );

      const result = await Effect.runPromise(program);

      if (!result.success) {
        // Log the error for debugging
        console.error("Effect action error:", result.error);
        throw new Error(result.error.message);
      }

      return result.data;
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
