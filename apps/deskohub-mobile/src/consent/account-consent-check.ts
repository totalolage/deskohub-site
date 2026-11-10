import { Context } from "effect";
import { Platform } from "react-native";

/**
 * Whether this device's analytics consent has been checked against the
 * signed-in account (`syncAnalyticsConsent`) recently enough to act on it.
 * Analytics holds everything attributed to the account until the check
 * settles (at sign-in or session restore, and again on each return to the
 * foreground), so an account withdrawal made elsewhere stops the device
 * before it sends anything that would revive the anonymised person. The
 * consent prompt waits for the session's first check, which may answer it
 * with the account's grant.
 */
export interface AccountConsentCheck {
  /** The signed-in account, or `undefined` while signed out. */
  readonly account: () => string | undefined;
  /** Follows the session: a different account starts unchecked. */
  readonly follow: (accountId: string | undefined) => void;
  /** Whether analytics must hold the account's delivery. */
  readonly holds: (accountId: string) => boolean;
  /** Whether the session's first check for its account is still pending. */
  readonly firstCheckPending: () => boolean;
  /** Records a finished check of `accountId`; ignored for another account. */
  readonly settle: (accountId: string) => void;
  /** Requires a new check, as when the app returns to the foreground. */
  readonly recheck: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export const createAccountConsentCheck = (): AccountConsentCheck => {
  let account: string | undefined;
  let checkedOnce = false;
  let current = false;
  const listeners = new Set<() => void>();

  const update = (next: {
    readonly account: string | undefined;
    readonly checkedOnce: boolean;
    readonly current: boolean;
  }) => {
    if (
      next.account === account &&
      next.checkedOnce === checkedOnce &&
      next.current === current
    ) {
      return;
    }
    ({ account, checkedOnce, current } = next);
    for (const listener of listeners) listener();
  };

  return {
    account: () => account,
    follow: (accountId) => {
      if (accountId === account) return;
      update({ account: accountId, checkedOnce: false, current: false });
    },
    holds: (accountId) => accountId !== account || !current,
    firstCheckPending: () => account !== undefined && !checkedOnce,
    settle: (accountId) => {
      if (accountId !== account) return;
      update({ account, checkedOnce: true, current: true });
    },
    recheck: () => update({ account, checkedOnce, current: false }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/**
 * Whether this platform checks consent against the account. Only the native
 * app does: the web bundle shares the site's consent cookie, which the site
 * already mirrors into the account (at sign-in and on each signed-in page)
 * and withdraws from it, so checking it here would mirror the same choice
 * twice under the app's source.
 */
export const accountConsentCheckEnabled = Platform.OS !== "web";

/** The app's one account consent check. */
export const appAccountConsentCheck = createAccountConsentCheck();

/**
 * The app's account consent check, for Effects that settle it. A Reference,
 * so every runtime shares it without wiring; tests provide their own.
 */
export const CurrentAccountConsentCheck =
  Context.Reference<AccountConsentCheck>(
    "deskohub-mobile/CurrentAccountConsentCheck",
    { defaultValue: () => appAccountConsentCheck }
  );
