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

export interface WorkspaceActionClientOptions {
  /**
   * Logs a failure the action runtime has not logged, such as one before the
   * action ran or a runtime that could not start. The runtime turns every
   * failure it logs into a `PublicSafeActionError`.
   */
  readonly logUnexpectedFailure: (error: Error) => Promise<void>;
  /** Reported for every failure that isn't a `PublicSafeActionError`. */
  readonly unexpectedFailure: LocalizedCopy;
}

/**
 * The safe-action client behind one Workspace action. A public error keeps its
 * message; any other failure, including a defect or a runtime that could not
 * start, is logged and reports `unexpectedFailure` in the action's locale.
 */
export const createWorkspaceActionClient = ({
  logUnexpectedFailure,
  unexpectedFailure,
}: WorkspaceActionClientOptions) =>
  createSafeActionClient({
    async handleServerError(error, { ctx }) {
      if (error instanceof PublicSafeActionError) {
        return error.message;
      }

      await logUnexpectedFailure(error);
      // A failure before the locale middleware ran leaves no locale behind.
      const locale =
        "locale" in ctx && isLocale(ctx.locale) ? ctx.locale : baseLocale;
      return unexpectedFailure({}, { locale });
    },
    defaultValidationErrorsShape: "flattened",
  }).use(localeMiddleware);
