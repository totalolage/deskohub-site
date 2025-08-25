import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import { localeMiddleware } from "./action-middleware/locale";
import { logger } from "./logger";

export const actionClient = createSafeActionClient({
  handleServerError(e) {
    logger.error("Action server error:", e);

    if (e.name === "ZodError") {
      logger.error(
        "Server-side validation error - this indicates a client-side validation bypass"
      );
      return "Validation error occurred. Please check your input.";
    }

    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
  defaultValidationErrorsShape: "flattened",
}).use(localeMiddleware);
