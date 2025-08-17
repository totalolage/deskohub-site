import { Schema } from "@effect/schema";
import { Effect, pipe } from "effect";
import { ValidationError } from "@/shared/backend/errors";

export function createEffectAction<I, O, E>(
  schema: Schema.Schema<I>,
  handler: (input: I) => Effect.Effect<O, E, never>
) {
  return async (input: unknown) => {
    const program = pipe(
      Schema.decodeUnknown(schema)(input),
      Effect.mapError(
        (parseError) => new ValidationError({ message: parseError.message })
      ),
      Effect.flatMap(handler),
      Effect.catchAll((error) =>
        Effect.fail({
          success: false,
          error: formatBackendError(error),
        })
      )
    );

    return Effect.runPromise(program);
  };
}

interface ErrorWithTag {
  _tag: string;
  code?: string;
  message?: string;
  details?: unknown;
}

function hasProperty<T extends object, K extends PropertyKey>(
  obj: T,
  key: K
): obj is T & Record<K, unknown> {
  return key in obj;
}

function isErrorWithTag(error: unknown): error is ErrorWithTag {
  if (error === null || typeof error !== "object") {
    return false;
  }

  if (!hasProperty(error, "_tag")) {
    return false;
  }

  return typeof error._tag === "string";
}

export function formatBackendError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (isErrorWithTag(error)) {
    return {
      code: error.code || error._tag,
      message: error.message || "An error occurred",
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: "UNKNOWN_ERROR",
      message: error.message,
      details: error.stack,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(error),
  };
}
