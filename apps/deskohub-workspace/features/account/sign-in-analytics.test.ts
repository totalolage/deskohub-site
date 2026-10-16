import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type {
  PasskeyAddedSource,
  SignInCodeRejectionReason,
  SignInMethod,
} from "./sign-in-analytics";

type SignInAnalyticsProperties =
  | { readonly method: SignInMethod }
  | { readonly reason: SignInCodeRejectionReason }
  | { readonly source: PasskeyAddedSource };

const posthogCapture = mock(
  (_event: string, _properties?: SignInAnalyticsProperties) => undefined
);

mock.module("posthog-js", () => ({
  default: { capture: posthogCapture },
}));

const completionStorageKey = "deskohub:account-sign-in-completion";
const consentCookie = `cc_cookie=${encodeURIComponent(
  JSON.stringify({ categories: ["necessary", "analytics"] })
)}; path=/`;
let signInAnalytics: typeof import("./sign-in-analytics");
let originalDateNow: typeof Date.now;
let currentTime: number;

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
    posthogCapture.mockClear();
  });

  afterEach(() => {
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

    expect(posthogCapture.mock.calls).toEqual([
      [signInAnalytics.SIGN_IN_COMPLETED_EVENT, { method: "code" }],
    ]);
  });

  test("does not record or capture a sign-in without consent", () => {
    signInAnalytics.recordSignInCompletion("code");
    signInAnalytics.captureRecordedSignInCompletion();

    expect(posthogCapture).not.toHaveBeenCalled();
  });

  test("keeps a fresh code sign-in when a link callback records with keepRecorded", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("code");
    signInAnalytics.recordSignInCompletion("link", { keepRecorded: true });

    signInAnalytics.captureRecordedSignInCompletion();

    expect(posthogCapture.mock.calls).toEqual([
      [signInAnalytics.SIGN_IN_COMPLETED_EVENT, { method: "code" }],
    ]);
  });

  test("uses the latest sign-in method without keepRecorded", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("code");
    signInAnalytics.recordSignInCompletion("link");

    signInAnalytics.captureRecordedSignInCompletion();

    expect(posthogCapture.mock.calls).toEqual([
      [signInAnalytics.SIGN_IN_COMPLETED_EVENT, { method: "link" }],
    ]);
  });

  test("discards a sign-in record older than five minutes", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("code");
    currentTime += 5 * 60 * 1000 + 1;

    signInAnalytics.captureRecordedSignInCompletion();

    expect(posthogCapture).not.toHaveBeenCalled();
  });

  test("captures only the rejection reason when analytics consent is present", () => {
    setAnalyticsConsent();

    signInAnalytics.captureSignInCodeRejection("too_many_attempts");

    expect(posthogCapture.mock.calls).toEqual([
      [
        signInAnalytics.SIGN_IN_CODE_REJECTED_EVENT,
        { reason: "too_many_attempts" },
      ],
    ]);
  });

  test("does not capture a code rejection without consent", () => {
    signInAnalytics.captureSignInCodeRejection("too_many_attempts");

    expect(posthogCapture).not.toHaveBeenCalled();
  });

  test("captures a recorded passkey sign-in", () => {
    setAnalyticsConsent();
    signInAnalytics.recordSignInCompletion("passkey");

    signInAnalytics.captureRecordedSignInCompletion();

    expect(posthogCapture.mock.calls).toEqual([
      [signInAnalytics.SIGN_IN_COMPLETED_EVENT, { method: "passkey" }],
    ]);
  });

  test("captures passkey changes and the prompt dismissal with consent only", () => {
    signInAnalytics.capturePasskeyAdded("prompt");
    signInAnalytics.capturePasskeyRemoved();
    signInAnalytics.capturePasskeyPromptDismissed();
    expect(posthogCapture).not.toHaveBeenCalled();

    setAnalyticsConsent();
    signInAnalytics.capturePasskeyAdded("settings");
    signInAnalytics.capturePasskeyRemoved();
    signInAnalytics.capturePasskeyPromptDismissed();

    expect(posthogCapture.mock.calls).toEqual([
      [signInAnalytics.PASSKEY_ADDED_EVENT, { source: "settings" }],
      [signInAnalytics.PASSKEY_REMOVED_EVENT],
      [signInAnalytics.PASSKEY_PROMPT_DISMISSED_EVENT],
    ]);
  });
});
