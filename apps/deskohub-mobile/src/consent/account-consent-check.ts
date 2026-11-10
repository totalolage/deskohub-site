import { Context } from "effect";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import type { AuthSessionState } from "../auth/auth-session-state";
import { consentChoiceMark, type StoredConsent } from "./analytics-consent";
import { appAnalyticsConsent } from "./use-analytics-consent";

/**
 * Whether this device's analytics consent has been checked against the
 * signed-in account (`syncAnalyticsConsent`) recently enough to act on it.
 * Analytics holds everything attributed to the account until the check
 * settles (at sign-in or session restore, and again on each return to the
 * foreground), so an account withdrawal made elsewhere stops the device
 * before it sends anything that would revive the anonymised person. A check
 * covers the device's choice it settled for: any other choice, such as the
 * customer's answer to the prompt, is held from the moment it is stored
 * until a check settles for it. The consent prompt waits for the session's
 * first check, which may answer it with the account's grant.
 */
export interface AccountConsentCheck {
  /** The signed-in account, or `undefined` while signed out. */
  readonly account: () => string | undefined;
  /** Follows the session: a different account starts unchecked. */
  readonly follow: (accountId: string | undefined) => void;
  /** Whether analytics must hold the account's delivery. */
  readonly holds: (accountId: string) => boolean;
  /**
   * Whether `accountId`'s first check of the session is still pending: until
   * the check follows it and a check of it settles.
   */
  readonly firstCheckPending: (accountId: string) => boolean;
  /**
   * Records a finished check of `accountId` for the device's `choice`;
   * ignored for another account, or once the device holds another choice,
   * which needs a check of its own.
   */
  readonly settle: (accountId: string, choice: StoredConsent) => void;
  /** Requires a new check, as when the app returns to the foreground. */
  readonly recheck: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** A check of the device's choice, read when it settles or holds. */
export const createAccountConsentCheck = (
  deviceChoice: () => StoredConsent | undefined
): AccountConsentCheck => {
  let account: string | undefined;
  let checkedOnce = false;
  let current = false;
  /** The device's choice the last check settled for. */
  let checkedChoice: string | undefined;
  const listeners = new Set<() => void>();

  const update = (next: {
    readonly account: string | undefined;
    readonly checkedOnce: boolean;
    readonly current: boolean;
    readonly checkedChoice: string | undefined;
  }) => {
    if (
      next.account === account &&
      next.checkedOnce === checkedOnce &&
      next.current === current &&
      next.checkedChoice === checkedChoice
    ) {
      return;
    }
    ({ account, checkedOnce, current, checkedChoice } = next);
    for (const listener of listeners) listener();
  };

  return {
    account: () => account,
    follow: (accountId) => {
      if (accountId === account) return;
      update({
        account: accountId,
        checkedOnce: false,
        current: false,
        checkedChoice: undefined,
      });
    },
    // Read from the device's choice itself, so a new choice is held before
    // anything that hears of it can act on it.
    holds: (accountId) =>
      accountId !== account ||
      !current ||
      checkedChoice !== consentChoiceMark(deviceChoice()),
    firstCheckPending: (accountId) => accountId !== account || !checkedOnce,
    settle: (accountId, choice) => {
      const mark = consentChoiceMark(choice);
      if (accountId !== account || mark !== consentChoiceMark(deviceChoice())) {
        return;
      }
      update({
        account,
        checkedOnce: true,
        current: true,
        checkedChoice: mark,
      });
    },
    recheck: () =>
      update({ account, checkedOnce, current: false, checkedChoice }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const ignoreChanges = () => () => {};

/**
 * Whether the consent prompt waits for the session's first account check,
 * which may answer it with the account's grant: while the stored session is
 * restored, and until the signed-in account's first check settles. Read from
 * the session being rendered, so a new account waits from its first render,
 * before the check follows it. Never without a check, as on the web bundle.
 */
export const useConsentPromptWaits = (
  check: AccountConsentCheck | undefined,
  session: AuthSessionState
): boolean => {
  const accountId =
    session.status === "signed-in" ? session.user.id : undefined;
  const firstCheckPending = () =>
    check !== undefined &&
    accountId !== undefined &&
    check.firstCheckPending(accountId);
  // The check lives in memory, so a server render reads it as the client does.
  const pending = useSyncExternalStore(
    check?.subscribe ?? ignoreChanges,
    firstCheckPending,
    firstCheckPending
  );
  return check !== undefined && (session.status === "restoring" || pending);
};

/**
 * Whether this platform checks consent against the account. Only the native
 * app does: the web bundle shares the site's consent cookie, which the site
 * already mirrors into the account (at sign-in and on each signed-in page)
 * and withdraws from it, so checking it here would mirror the same choice
 * twice under the app's source.
 */
export const accountConsentCheckEnabled = Platform.OS !== "web";

/** The app's one account consent check, of the app's consent answer. */
export const appAccountConsentCheck = createAccountConsentCheck(() =>
  appAnalyticsConsent().current()
);

/**
 * The app's account consent check, for Effects that settle it. A Reference,
 * so every runtime shares it without wiring; tests provide their own.
 */
export const CurrentAccountConsentCheck =
  Context.Reference<AccountConsentCheck>(
    "deskohub-mobile/CurrentAccountConsentCheck",
    { defaultValue: () => appAccountConsentCheck }
  );
