"use client";

import {
  beginAnalyticsAccountTransition,
  completeAnalyticsAccountSignOut,
  refreshAnalyticsAccountIdentity,
} from "@/features/account/analytics-identity";
import { authClient } from "@/features/account/auth.client";

/**
 * An account exit in flight, such as a sign-out or a deletion request. The
 * first of `left` or `stayed` settles it; later calls do nothing.
 */
export type AccountExit = {
  /**
   * The account is gone from this browser. Resets analytics to anonymous and
   * tells other tabs. Call it before leaving the page.
   */
  readonly left: () => void;
  /**
   * The exit failed or ended without signing out. Settles the analytics
   * transition from the authoritative session; a failed refresh is reported
   * there and never rejects.
   */
  readonly stayed: () => void;
};

/**
 * Starts an account exit: analytics pauses as `pending` until the exit
 * settles, so no event goes out under an identity that may be ending.
 */
export const beginAccountExit = (): AccountExit => {
  beginAnalyticsAccountTransition();
  let settled = false;
  const settleOnce = (settle: () => void) => () => {
    if (settled) return;
    settled = true;
    settle();
  };

  return {
    left: settleOnce(completeAnalyticsAccountSignOut),
    stayed: settleOnce(() => {
      void refreshAnalyticsAccountIdentity({ settleTransition: true });
    }),
  };
};

export type AccountSignOutOutcome = "signed-out" | "failed";

/**
 * Signs this browser out of the account. `"signed-out"` means the session
 * ended and analytics is anonymous, so the caller can leave the page;
 * `"failed"` keeps the account, with the raw failure withheld.
 */
export const signOutOfAccount = async (): Promise<AccountSignOutOutcome> => {
  const exit = beginAccountExit();
  try {
    const result = await authClient.signOut();
    if (result.error) {
      exit.stayed();
      return "failed";
    }
  } catch {
    exit.stayed();
    return "failed";
  }
  exit.left();
  return "signed-out";
};
