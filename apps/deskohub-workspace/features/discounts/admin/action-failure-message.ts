import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { getActionFailureMessage } from "@/shared/utils/action-runtime-failure";

/**
 * The operator-facing message for a failed discount administration action. The action's own
 * message is already localized; a failure the action runtime reports in
 * English gets administration copy, and anything else gets `fallback`.
 */
export const getDiscountAdminActionFailureMessage = (
  serverError: string | undefined,
  { fallback, locale }: { readonly fallback: string; readonly locale: Locale }
) =>
  getActionFailureMessage(serverError, {
    fallback,
    timeout: m.discountsActionTimedOut({}, { locale }),
    unexpected: m.discountsActionFailedUnexpectedly({}, { locale }),
  });
