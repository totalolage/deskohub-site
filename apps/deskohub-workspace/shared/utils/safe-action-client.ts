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
      let value: unknown;
      if (Cause.isFailReason(reason)) value = reason.error;
      else if (Cause.isDieReason(reason)) value = reason.defect;
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
