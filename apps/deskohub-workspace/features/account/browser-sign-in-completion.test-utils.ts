import { testEmailAddress } from "@deskohub/test-email";
import {
  type AnalyticsEvent,
  deliverAnalyticsEvents,
  discardAnalyticsEvents,
} from "@/features/cookie-consent/analytics-events";
import {
  noteEmailSignInForPasskeyPrompt,
  shouldOfferPasskeyPrompt,
} from "./passkey-prompt";
import {
  captureRecordedSignInCompletion,
  SIGN_IN_COMPLETED_EVENT,
} from "./sign-in-analytics";

/*
 * Reads the outcomes of a finished browser sign-in the way the next page
 * does, instead of asserting which storage helpers ran. Needs a registered
 * DOM on an http(s) URL, where the consent cookie can be set.
 */

const consentCookie = `cc_cookie=${encodeURIComponent(
  JSON.stringify({ categories: ["necessary", "analytics"] })
)}; path=/`;
const pendingRequestStorageKey = "deskohub:account-sign-in-code";

/**
 * Accepts analytics for the test document and collects the analytics events
 * it captures until `stop`.
 */
export const observeSignInAnalytics = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: Tests set the cookie the analytics consent boundary reads.
  document.cookie = consentCookie;
  const events: AnalyticsEvent[] = [];
  const detach = deliverAnalyticsEvents((event) => {
    events.push(event);
  });
  return {
    events,
    /**
     * Captures and forgets this tab's recorded sign-in completion, as the
     * next page does; returns its method, if any.
     */
    takeRecordedSignInMethod: (): unknown => {
      const capturedBefore = events.length;
      captureRecordedSignInCompletion();
      return events
        .slice(capturedBefore)
        .find(({ event }) => event === SIGN_IN_COMPLETED_EVENT)?.properties
        ?.method;
    },
    stop: () => {
      captureRecordedSignInCompletion();
      detach();
      discardAnalyticsEvents();
      // biome-ignore lint/suspicious/noDocumentCookie: Tests clear the consent cookie between cases.
      document.cookie = "cc_cookie=; Path=/; Max-Age=0";
    },
  };
};

const passkeyCapableBrowser = {
  getClientCapabilities: async () => ({ passkeyPlatformAuthenticator: true }),
};

/**
 * Whether the account page would offer `accountId` a passkey now, on a
 * browser that can create one. Like the page, it uses up an email sign-in
 * note.
 */
export const offersPasskeyPrompt = async (accountId: string) => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "PublicKeyCredential"
  );
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: passkeyCapableBrowser,
  });
  try {
    return await shouldOfferPasskeyPrompt({
      accountId,
      accountHasPasskeys: undefined,
    });
  } finally {
    if (original)
      Object.defineProperty(globalThis, "PublicKeyCredential", original);
    else Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  }
};

/** Whether this browser remembers holding a passkey for `accountId`. */
export const remembersPasskeyFor = async (accountId: string) => {
  noteEmailSignInForPasskeyPrompt();
  return !(await offersPasskeyPrompt(accountId));
};

/** Stores a pending sign-in email request for this tab. */
export const storePendingEmailSignInRequest = () => {
  sessionStorage.setItem(
    pendingRequestStorageKey,
    JSON.stringify({ email: testEmailAddress("ada"), requestedAt: Date.now() })
  );
};

/** Whether a reload of this tab would restore a pending sign-in request. */
export const hasStoredEmailSignInRequest = () =>
  sessionStorage.getItem(pendingRequestStorageKey) !== null;
