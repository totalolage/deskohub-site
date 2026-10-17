import { m } from "@/features/administration/i18n";
import { createActionFailureMessage } from "@/shared/utils/action-runtime-failure";

/**
 * The operator-facing message for a failed reservation administration action.
 * The action's own message is already localized; a failure the action runtime
 * reports in English gets administration copy, and anything else gets
 * `fallback`.
 */
export const getAdministrationActionFailureMessage = createActionFailureMessage(
  {
    timeout: m.administrationActionTimedOut,
    unexpected: m.administrationActionFailedUnexpectedly,
  }
);
