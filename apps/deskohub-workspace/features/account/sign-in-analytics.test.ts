import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  type AnalyticsEvent,
  deliverAnalyticsEvents,
  discardAnalyticsEvents,
} from "@/features/cookie-consent/analytics-events";

const completionStorageKey = "deskohub:account-sign-in-completion";
const consentCookie = `cc_cookie=${encodeURIComponent(
  JSON.stringify({ categories: ["necessary", "analytics"] })
)}; path=/`;
let signInAnalytics: typeof import("./sign-in-analytics");
let originalDateNow: typeof Date.now;
let currentTime: number;
let capturedEvents: AnalyticsEvent[] = [];
let detachAnalyticsEvents: (() => void) | undefined;

const setAnalyticsConsent = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: This test sets the cookie consumed by the analytics boundary.
  document.cookie = consentCookie;
};

const clearAnalyticsConsent = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: This test clears the consent cookie between cases.
  document.cookie = "cc_cookie=; Path=/; Max-Age=0";
};

describe("sign-in analytics", () => {
  beforeAll(async () => {
    GlobalRegistrator.register();
    originalDateNow = Date.now;
    signInAnalytics = await import("./sign-in-analytics");
  });

  beforeEach(() => {
    window.happyDOM.setURL("https://deskohub.test/account");
    currentTime = Date.parse("2026-10-15T12:00:00.000Z");
    Date.now = () => currentTime;
    globalThis.sessionStorage.removeItem(completionStorageKey);
    clearAnalyticsConsent();
    capturedEvents = [];
    detachAnalyticsEvents = deliverAnalyticsEvents((event) => {
      capturedEvents.push(event);
    });
  });

  afterEach(() => {
    detachAnalyticsEvents?.();
    discardAnalyticsEvents();
    Date.now = originalDateNow;
    globalThis.sessionStorage.removeItem(completionStorageKey);
    clearAnalyticsConsent();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("captures a recorded code sign-in once", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("code");

    signInAnalytics.captureRecordedSignInCompletion();
    signInAnalytics.captureRecordedSignInCompletion();

    expect(capturedEvents).toEqual([
      {
        event: signInAnalytics.SIGN_IN_COMPLETED_EVENT,
        properties: { method: "code" },
      },
    ]);
  });

  test("does not record or capture a sign-in without consent", () => {
    signInAnalytics.recordSignInCompletion("code");
    signInAnalytics.captureRecordedSignInCompletion();

    expect(capturedEvents).toEqual([]);
  });

  test("keeps a fresh code sign-in when a link callback records with keepRecorded", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("code");
    signInAnalytics.recordSignInCompletion("link", { keepRecorded: true });

    signInAnalytics.captureRecordedSignInCompletion();

    expect(capturedEvents).toEqual([
      {
        event: signInAnalytics.SIGN_IN_COMPLETED_EVENT,
        properties: { method: "code" },
      },
    ]);
  });

  test("uses the latest sign-in method without keepRecorded", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("code");
    signInAnalytics.recordSignInCompletion("link");

    signInAnalytics.captureRecordedSignInCompletion();

    expect(capturedEvents).toEqual([
      {
        event: signInAnalytics.SIGN_IN_COMPLETED_EVENT,
        properties: { method: "link" },
      },
    ]);
  });

  test("discards a sign-in record older than five minutes", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("code");
    currentTime += 5 * 60 * 1000 + 1;

    signInAnalytics.captureRecordedSignInCompletion();

    expect(capturedEvents).toEqual([]);
  });

  test("captures only the rejection reason when analytics consent is present", () => {
    setAnalyticsConsent();

    signInAnalytics.captureSignInCodeRejection("too_many_attempts");

    expect(capturedEvents).toEqual([
      {
        event: signInAnalytics.SIGN_IN_CODE_REJECTED_EVENT,
        properties: { reason: "too_many_attempts" },
      },
    ]);
  });

  test("does not capture a code rejection without consent", () => {
    signInAnalytics.captureSignInCodeRejection("too_many_attempts");

    expect(capturedEvents).toEqual([]);
  });

  test("captures a recorded passkey sign-in", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("passkey");

    signInAnalytics.captureRecordedSignInCompletion();

    expect(capturedEvents).toEqual([
      {
        event: signInAnalytics.SIGN_IN_COMPLETED_EVENT,
        properties: { method: "passkey" },
      },
    ]);
  });

  test("captures passkey changes and the prompt dismissal with consent only", () => {
    signInAnalytics.capturePasskeyAdded("prompt");
    signInAnalytics.capturePasskeyRemoved();
    signInAnalytics.capturePasskeyPromptDismissed();
    expect(capturedEvents).toEqual([]);

    setAnalyticsConsent();
    signInAnalytics.capturePasskeyAdded("settings");
    signInAnalytics.capturePasskeyRemoved();
    signInAnalytics.capturePasskeyPromptDismissed();

    expect(capturedEvents).toEqual([
      {
        event: signInAnalytics.PASSKEY_ADDED_EVENT,
        properties: { source: "settings" },
      },
      { event: signInAnalytics.PASSKEY_REMOVED_EVENT },
      { event: signInAnalytics.PASSKEY_PROMPT_DISMISSED_EVENT },
    ]);
  });
});
