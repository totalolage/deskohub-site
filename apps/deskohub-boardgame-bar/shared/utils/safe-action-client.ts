import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import type { Locale } from "@/features/i18n";
import { localeMiddleware } from "./action-middleware/locale";

export const actionClient = createSafeActionClient({
  handleServerError(e) {
    // Server errors are logged through Effect's logging system
    if (e.name === "ZodError") {
      return "Validation error occurred. Please check your input.";
    }

    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
  defaultValidationErrorsShape: "flattened",
}).use<{ locale: Locale }>(localeMiddleware);
