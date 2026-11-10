import type { AuthSessionState } from "../auth/auth-session-state";
import type { AppLocale } from "./app-locale";

/**
 * A locale the customer chose in the app and saved to their account, shown
 * before the session confirms it.
 *
 * Lifetime: it belongs to the account that chose it and ends when that
 * account signs out or another one signs in. After the save the app asks
 * Better Auth to read the session again; the first read that completes after
 * the save hands the locale back to the session, whatever value it carries,
 * so a later change from the web wins. If that read fails, the choice lasts
 * until the next read that succeeds (Better Auth reads again when the app
 * returns to the foreground).
 */
export interface LocaleOverride {
  readonly userId: string;
  readonly locale: AppLocale;
  /** The count of completed session reads when the save succeeded. */
  readonly afterRead: number;
}

/** The account a session is signed in to, if any. */
export const sessionUserId = (session: AuthSessionState): string | undefined =>
  session.status === "signed-in" ? session.user.id : undefined;

/** The override for a choice saved while `userId` was signed in. */
export const localeOverride = (
  userId: string | undefined,
  locale: AppLocale,
  sessionReads: number
): LocaleOverride | undefined =>
  userId === undefined
    ? undefined
    : { userId, locale, afterRead: sessionReads };

/** The override to keep while `userId` is signed in: none once its account is gone. */
export const overrideFor = (
  override: LocaleOverride | undefined,
  userId: string | undefined
): LocaleOverride | undefined =>
  override?.userId === userId ? override : undefined;

/**
 * The locale the app shows: a choice still awaiting the session, else the
 * account's saved locale while signed in, else the launch locale (the
 * device's language, or on the web the native app's sign-in request's).
 */
export const activeLocale = ({
  session,
  sessionReads,
  launchLocale,
  override,
}: {
  readonly session: AuthSessionState;
  /** How many session reads have completed (`countSessionReads`). */
  readonly sessionReads: number;
  readonly launchLocale: AppLocale;
  readonly override?: LocaleOverride | undefined;
}): AppLocale => {
  if (session.status !== "signed-in") return launchLocale;
  if (
    override !== undefined &&
    override.userId === session.user.id &&
    sessionReads <= override.afterRead
  ) {
    return override.locale;
  }
  return session.locale ?? launchLocale;
};
