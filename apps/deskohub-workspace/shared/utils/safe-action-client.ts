import { Cause, Data } from "effect";
import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import { localeMiddleware } from "./action-middleware/locale";

export class PublicSafeActionError extends Data.TaggedError(
  "PublicSafeActionError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function getPublicSafeActionErrorMessage(error: unknown): string | null {
  if (Cause.isCause(error)) {
    for (const reason of error.reasons) {
      const value = Cause.isFailReason(reason)
        ? reason.error
        : Cause.isDieReason(reason)
          ? reason.defect
          : undefined;
      const message = getPublicSafeActionErrorMessage(value);
      if (message) return message;
    }
  }

  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as {
    readonly _tag?: unknown;
    readonly message?: unknown;
    readonly cause?: unknown;
  };

  if (
    candidate._tag === "PublicSafeActionError" &&
    typeof candidate.message === "string"
  ) {
    return candidate.message;
  }

  return getPublicSafeActionErrorMessage(candidate.cause);
}

export const actionClient = createSafeActionClient({
  handleServerError(error) {
    if (error.name === "ZodError") {
      return "Validation error occurred. Please check your input.";
    }

    const publicErrorMessage = getPublicSafeActionErrorMessage(error);

    if (publicErrorMessage) {
      return publicErrorMessage;
    }

    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
  defaultValidationErrorsShape: "flattened",
}).use(localeMiddleware);
