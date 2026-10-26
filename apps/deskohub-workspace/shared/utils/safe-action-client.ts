import { Data } from "effect";
import { createSafeActionClient } from "next-safe-action";
import { baseLocale, isLocale, type LocalizedCopy } from "@/features/i18n";
import { localeMiddleware } from "./action-middleware/locale";

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

/**
 * The safe-action client behind one Workspace action. A public error keeps its
 * message; any other failure, including a defect or a runtime that could not
 * start, reports `unexpectedFailure` in the action's locale.
 */
export const createWorkspaceActionClient = (unexpectedFailure: LocalizedCopy) =>
  createSafeActionClient({
    handleServerError(error, { ctx }) {
      if (error instanceof PublicSafeActionError) {
        return error.message;
      }

      // A failure before the locale middleware ran leaves no locale behind.
      const locale =
        "locale" in ctx && isLocale(ctx.locale) ? ctx.locale : baseLocale;
      return unexpectedFailure({}, { locale });
    },
    defaultValidationErrorsShape: "flattened",
  }).use(localeMiddleware);
