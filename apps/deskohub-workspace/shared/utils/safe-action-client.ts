import { Data } from "effect";
import { createSafeActionClient } from "next-safe-action";
import { localeMiddleware } from "./action-middleware/locale";
import { actionRuntimeFailureMessages } from "./action-runtime-failure";

export type SafeActionFailure =
  | Error
  | {
      readonly _tag: string;
    };

export class PublicSafeActionError extends Data.TaggedError(
  "PublicSafeActionError"
)<{
  readonly message: string;
  readonly cause?: SafeActionFailure;
}> {}

export const actionClient = createSafeActionClient({
  handleServerError(error) {
    if (error.name === "ZodError") {
      return actionRuntimeFailureMessages.invalidInput;
    }

    if (error instanceof PublicSafeActionError) {
      return error.message;
    }

    return actionRuntimeFailureMessages.unexpected;
  },
  defaultValidationErrorsShape: "flattened",
}).use(localeMiddleware);
