import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import { localeMiddleware } from "./action-middleware/locale";

export const actionClient = createSafeActionClient({
  // Handle server errors properly
  handleServerError(e) {
    console.error("Action server error:", e);

    // If it's a ZodError, it means validation failed on the server
    // This shouldn't happen if client validation is working correctly
    if (e.name === "ZodError") {
      console.error(
        "Server-side validation error - this indicates a client-side validation bypass"
      );
      return "Validation error occurred. Please check your input.";
    }

    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
  // Use flattened validation errors for easier handling
  defaultValidationErrorsShape: "flattened",
}).use(localeMiddleware);
