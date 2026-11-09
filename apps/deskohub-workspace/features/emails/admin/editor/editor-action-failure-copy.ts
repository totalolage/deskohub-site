import { m } from "@/features/administration/i18n";
import type { WorkspaceActionFailureCopy } from "@/shared/backend/workspace-action";

/** How the action runtime words its own failures in email editor actions. */
export const emailsEditorActionFailureCopy: WorkspaceActionFailureCopy = {
  timeout: m.emailsActionTimedOut,
  unexpected: m.emailsActionFailedUnexpectedly,
};
