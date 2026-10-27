import { Effect } from "effect";
import { sharedReferralCodeRememberedDays } from "@/features/referrals/program";
import { referralCodeCookieName } from "@/features/referrals/referral-code-cookie";
import type {
  E2EBrowserCookieDescription,
  E2EBrowserSession,
} from "../browser-session";
import type { WorkspaceE2EConfig } from "../config";
import { pollUntil } from "../polling";
import { workspaceE2EPollIntervalMs } from "../timeouts";

/**
 * The remembered referral cookie a shared link sets: first-party, readable by
 * the page, sent on top-level navigations, and kept for the program's window.
 */
const isRememberedReferralCookie = (cookie: E2EBrowserCookieDescription) =>
  cookie.present &&
  cookie.matches === true &&
  !cookie.httpOnly &&
  cookie.secure &&
  cookie.sameSite === "Lax" &&
  cookie.path === "/" &&
  cookie.lifetimeDays !== null &&
  Math.abs(cookie.lifetimeDays - sharedReferralCodeRememberedDays) <= 1;

const pollReferralCookie = (
  {
    config,
    session,
  }: {
    readonly config: Pick<WorkspaceE2EConfig, "baseUrl" | "timeouts">;
    readonly session: E2EBrowserSession;
  },
  label: string,
  code: string | undefined,
  accept: (cookie: E2EBrowserCookieDescription) => boolean
) =>
  pollUntil(
    session
      .describeCookie({
        name: referralCodeCookieName,
        url: config.baseUrl,
        ...(code === undefined ? {} : { value: code }),
      })
      .pipe(Effect.map((cookie) => (accept(cookie) ? cookie : undefined))),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label,
      timeoutMs: config.timeouts.uiTransition,
    }
  );

/** The browser remembers exactly this code from the first shared link. */
export const waitForRememberedReferralCode = (
  context: Parameters<typeof pollReferralCookie>[0],
  code: string
) =>
  pollReferralCookie(
    context,
    "remembered referral code cookie",
    code,
    isRememberedReferralCookie
  ).pipe(Effect.asVoid);

/**
 * The browser remembers no referral code: a fresh context, or one whose code
 * was used up. The account page forgets it after hydration, so this polls.
 */
export const waitForNoRememberedReferralCode = (
  context: Parameters<typeof pollReferralCookie>[0]
) =>
  pollReferralCookie(
    context,
    "no remembered referral code cookie",
    undefined,
    (cookie) => !cookie.present
  ).pipe(Effect.asVoid);
