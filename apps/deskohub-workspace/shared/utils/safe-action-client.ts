import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import { localeMiddleware } from "./action-middleware/locale";

export class PublicSafeActionError extends Error {
  constructor(
    message: string,
    errorOptions?: ErrorOptions
  ) {
    super(message, errorOptions);
    this.name = "PublicSafeActionError";
  }
}

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
