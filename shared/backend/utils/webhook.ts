/**
 * Shared webhook utilities for all webhook handlers
 */

import { Data, Effect } from "effect";
import { env } from "@/env";
import { isDev } from "@/shared/utils/environment";

/**
 * Common Webhook Errors
 */
export class WebhookAuthError extends Data.TaggedError("WebhookAuthError")<{
  readonly message: string;
}> {}

export class WebhookValidationError extends Data.TaggedError(
  "WebhookValidationError"
)<{
  readonly message: string;
  readonly issues?: unknown;
  readonly payload?: string;
  readonly cause?: unknown;
}> {}

/**
 * Validate webhook security using UUID secret (Dotypos webhooks)
 *
 * @param url - The request URL containing the secret parameter
 * @returns Effect that fails with WebhookAuthError if validation fails
 */
export const validateWebhookUUID = (url: URL) =>
  Effect.gen(function* () {
    // Skip validation in development
    if (isDev()) {
      yield* Effect.logDebug("Webhook UUID validation skipped in development");
      return;
    }

    const providedSecret = url.searchParams.get("secret");

    if (!providedSecret) {
      yield* Effect.fail(
        new WebhookAuthError({ message: "Missing webhook secret" })
      );
    }

    if (providedSecret !== env.DOTYPOS_WEBHOOK_SECRET) {
      yield* Effect.fail(
        new WebhookAuthError({ message: "Invalid webhook secret" })
      );
    }

    yield* Effect.logDebug("Webhook UUID validation successful");
  });

/**
 * Standard webhook error handler
 *
 * Handles WebhookAuthError and other errors with appropriate logging
 */
export const handleWebhookError = <A extends { success: true }>(
  effect: Effect.Effect<A, WebhookAuthError | WebhookValidationError | Error>
): Effect.Effect<
  | A
  | { success: false; error: "Unauthorized"; message: string }
  | { success: false; error: "Bad Request"; message: string; issues: unknown }
  | { success: false; error: "Internal Server Error"; message: string },
  never
> =>
  effect.pipe(
    Effect.catchTags({
      WebhookAuthError: (error) =>
        Effect.succeed({
          success: false as const,
          error: "Unauthorized" as const,
          message: error.message,
        }),
      WebhookValidationError: (error) =>
        Effect.succeed({
          success: false as const,
          error: "Bad Request" as const,
          message: error.message,
          issues: error.issues,
        }),
    }),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* Effect.logError("Unexpected error in webhook", error);
        return {
          success: false as const,
          error: "Internal Server Error" as const,
          message: error instanceof Error ? error.message : "Unknown error",
        };
      })
    )
  );

/**
 * Type for webhook responses
 */
export type WebhookResponse<T = unknown> =
  | {
      success: true;
      data?: T;
      message?: string;
    }
  | {
      success: false;
      error: "Unauthorized" | "Bad Request" | "Internal Server Error";
      message: string;
      issues?: unknown;
    };
