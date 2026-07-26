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
}> {
  readonly #brand = true;

  static is(value: unknown): value is PublicSafeActionError {
    return typeof value === "object" && value !== null && #brand in value;
  }
}

export function getPublicSafeActionErrorMessage(error: unknown): string | null {
  return getPublicSafeActionErrorMessageInternal(error, new WeakSet());
}

const getPublicSafeActionErrorMessageInternal = (
  error: unknown,
  seen: WeakSet<object>
): string | null => {
  if (PublicSafeActionError.is(error)) return error.message;

  if (Cause.isCause(error)) {
    for (const reason of error.reasons) {
      const value = Cause.isFailReason(reason)
        ? reason.error
        : Cause.isDieReason(reason)
          ? reason.defect
          : undefined;
      const message = getPublicSafeActionErrorMessageInternal(value, seen);
      if (message) return message;
    }
    return null;
  }

  if (!error || typeof error !== "object") {
    return null;
  }
  if (seen.has(error)) return null;
  seen.add(error);

  if (error instanceof AggregateError) {
    for (const nestedError of error.errors) {
      const message = getPublicSafeActionErrorMessageInternal(
        nestedError,
        seen
      );
      if (message) return message;
    }
  }

  const cause = Object.getOwnPropertyDescriptor(error, "cause")?.value;
  return getPublicSafeActionErrorMessageInternal(cause, seen);
};

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
