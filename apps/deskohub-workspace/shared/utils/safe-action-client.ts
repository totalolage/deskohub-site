import { Data } from "effect";
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

export const actionClient = createSafeActionClient({
  handleServerError(error) {
    if (error.name === "ZodError") {
      return "Validation error occurred. Please check your input.";
    }

    if (error instanceof PublicSafeActionError) {
      return error.message;
    }

    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
  defaultValidationErrorsShape: "flattened",
}).use(localeMiddleware);
