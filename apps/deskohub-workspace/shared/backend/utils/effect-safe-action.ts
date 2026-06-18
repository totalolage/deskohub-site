import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  type ConfigError,
  Duration,
  Effect,
  type Layer,
  Logger,
  LogLevel,
} from "effect";
import type { Locale } from "@/features/i18n";
import { runWorkspaceServerActionEffect } from "@/shared/backend/logging/server-action";
import { formatEffectError } from "@/shared/utils/error-formatting";
import {
  actionClient,
  getPublicSafeActionErrorMessage,
  PublicSafeActionError,
} from "@/shared/utils/safe-action-client";

type ParsedInput<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

export function createEffectSafeAction<S extends StandardSchemaV1, O, E, R>(
  schema: S,
  handler: (
    input: ParsedInput<S>,
    context: { locale: Locale }
  ) => Effect.Effect<O, E, R>,
  layers: Layer.Layer<R, ConfigError.ConfigError, never>
) {
  return actionClient
    .inputSchema(schema)
    .action(async ({ parsedInput, ctx }) => {
      const { locale } = ctx as { locale: Locale };

      const program = Effect.gen(function* () {
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
        Effect.provide(layers),
        Effect.timeoutFail({
          duration: Duration.seconds(45),
          onTimeout: () => new Error("Request timed out. Please try again."),
        })
      );

      try {
        return await runWorkspaceServerActionEffect(
          Logger.withMinimumLogLevel(program, LogLevel.All)
        );
      } catch (error: unknown) {
        const publicErrorMessage = getPublicSafeActionErrorMessage(error);

        if (publicErrorMessage) {
          throw new PublicSafeActionError({
            message: publicErrorMessage,
            cause: error,
          });
        }

        const formatted = formatEffectError(error);
        throw new Error(formatted.code || "INTERNAL_ACTION_ERROR");
      }
    });
}
