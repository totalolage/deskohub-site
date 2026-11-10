import { useCallback, useMemo, useState } from "react";
import type { AuthSessionState } from "../auth/auth-session-state";
import {
  currentSessionReads,
  useSessionReads,
} from "../auth/use-session-reads";
import {
  activeLocale,
  type LocaleOverride,
  localeOverride,
  overrideFor,
  sessionUserId,
} from "./active-locale";
import type { AppLocale } from "./app-locale";

/**
 * The locale the app shows for `session` (see {@link activeLocale}), and how
 * to show a locale the customer just saved to their account.
 */
export const useSessionLocale = (
  session: AuthSessionState,
  launchLocale: AppLocale
) => {
  const sessionReads = useSessionReads();
  const [override, setOverride] = useState<LocaleOverride>();
  const userId = sessionUserId(session);
  // A sign-out or another account drops the choice for good.
  const kept = overrideFor(override, userId);
  if (kept !== override) setOverride(kept);
  const locale = activeLocale({
    session,
    sessionReads,
    launchLocale,
    override: kept,
  });
  const choose = useCallback(
    (chosen: AppLocale) =>
      setOverride(localeOverride(userId, chosen, currentSessionReads())),
    [userId]
  );
  return useMemo(() => ({ locale, choose }), [locale, choose]);
};
