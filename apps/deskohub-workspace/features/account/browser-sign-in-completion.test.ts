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
import type { BrowserSignInCompletion } from "./browser-sign-in-completion";
import {
  hasStoredEmailSignInRequest,
  observeSignInAnalytics,
  offersPasskeyPrompt,
  remembersPasskeyFor,
  storePendingEmailSignInRequest,
} from "./browser-sign-in-completion.test-utils";

const accountId = "account-1";

let completion: typeof import("./browser-sign-in-completion");
let documentNavigation: typeof import("@/shared/browser/document-navigation");
let analytics: ReturnType<typeof observeSignInAnalytics>;
let originalReplace: typeof window.location.replace;
const replace = mock((_url: string | URL) => undefined);

describe("browser sign-in completion", () => {
  beforeAll(async () => {
    GlobalRegistrator.register({ url: "https://deskohub.test/en-US/account" });
    originalReplace = window.location.replace;
    completion = await import("./browser-sign-in-completion");
    documentNavigation = await import("@/shared/browser/document-navigation");
  });

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    replace.mockReset();
    replace.mockImplementation(() => undefined);
    window.location.replace = replace as typeof window.location.replace;
    analytics = observeSignInAnalytics();
  });

  afterEach(() => {
    analytics.stop();
    window.location.replace = originalReplace;
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test.each([
    [{ method: "code" }, "code"],
    [{ method: "link", via: "hand-off" }, "link"],
    [{ method: "link", via: "callback" }, "link"],
  ] satisfies ReadonlyArray<readonly [BrowserSignInCompletion, string]>)(
    "records %j and offers the account's passkey prompt once",
    async (signIn, method) => {
      completion.completeBrowserSignIn(signIn);

      expect(analytics.takeRecordedSignInMethod()).toBe(method);
      expect(await offersPasskeyPrompt(accountId)).toBe(true);
      expect(await offersPasskeyPrompt(accountId)).toBe(false);
    }
  );

  test("records a passkey sign-in and remembers the passkey without offering one", async () => {
    completion.completeBrowserSignIn({ method: "passkey", accountId });

    expect(analytics.takeRecordedSignInMethod()).toBe("passkey");
    expect(await offersPasskeyPrompt(accountId)).toBe(false);
    expect(await remembersPasskeyFor(accountId)).toBe(true);
    expect(await remembersPasskeyFor("account-2")).toBe(false);
  });

  test("records a passkey sign-in whose account the server didn't name", () => {
    completion.completeBrowserSignIn({ method: "passkey" });

    expect(analytics.takeRecordedSignInMethod()).toBe("passkey");
  });

  test("keeps a fresh code record when the code passes through the link callback", () => {
    completion.completeBrowserSignIn({ method: "code" });
    completion.completeBrowserSignIn({ method: "link", via: "callback" });

    expect(analytics.takeRecordedSignInMethod()).toBe("code");
  });

  test("replaces an earlier record with a link handed off to this tab", () => {
    completion.completeBrowserSignIn({ method: "code" });
    completion.completeBrowserSignIn({ method: "link", via: "hand-off" });

    expect(analytics.takeRecordedSignInMethod()).toBe("link");
  });

  test("records nothing without analytics consent but still offers the passkey prompt", async () => {
    analytics.stop();

    completion.completeBrowserSignIn({ method: "code" });

    analytics = observeSignInAnalytics();
    expect(analytics.takeRecordedSignInMethod()).toBeUndefined();
    expect(await offersPasskeyPrompt(accountId)).toBe(true);
  });

  test.each([
    [{ method: "passkey", accountId }, false],
    [{ method: "link", via: "callback" }, false],
    [{ method: "link", via: "hand-off" }, true],
    [{ method: "code" }, true],
  ] satisfies ReadonlyArray<readonly [BrowserSignInCompletion, boolean]>)(
    "after %j, a reload restores the pending email request: %p",
    (signIn, kept) => {
      storePendingEmailSignInRequest();

      completion.completeBrowserSignIn(signIn);

      expect(hasStoredEmailSignInRequest()).toBe(kept);
    }
  );

  test("keeps the pending email request when the browser blocks the navigation", () => {
    storePendingEmailSignInRequest();
    window.location.replace = (() => {
      throw new Error("navigation blocked");
    }) as typeof window.location.replace;

    expect(completion.leaveForSignInDestination("/en-US/account")).toBe(false);
    expect(hasStoredEmailSignInRequest()).toBe(true);
  });

  test("replaces the document and forgets the pending email request once it leaves", () => {
    storePendingEmailSignInRequest();

    expect(completion.leaveForSignInDestination("/en-US/account")).toBe(true);

    expect(replace.mock.calls).toEqual([["/en-US/account"]]);
    expect(hasStoredEmailSignInRequest()).toBe(false);
    // A later signed-out redirect keeps this destination.
    expect(documentNavigation.isLeavingDocument()).toBe(true);
  });
});
