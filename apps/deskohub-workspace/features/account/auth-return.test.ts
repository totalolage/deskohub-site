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
import { testEmailAddress } from "@deskohub/test-email";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { unsafeReturnTargets } from "@/shared/testing/unsafe-return-targets.test-utils";
import type { AuthReturnLifecycle } from "./auth-return";

const customerEmail = testEmailAddress("ada");

const VALID_ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";

type ReturnListener = {
  readonly attemptId: string;
  readonly onReturn: (signal: AbortSignal) => Promise<boolean>;
};
type SessionData = {
  readonly session: { readonly createdAt: Date };
  readonly user: { readonly emailVerified: boolean };
};
type SessionRequestOptions = {
  readonly fetchOptions: { readonly cache: "no-store" };
  readonly query: { readonly disableCookieCache: true };
};

const events: string[] = [];
let listener: ReturnListener | undefined;
const listenerCleanups: Array<ReturnType<typeof mock>> = [];
const listenForReturn = mock((options: ReturnListener) => {
  events.push("listen");
  listener = options;
  const cleanup = mock(() => {
    events.push("cleanup");
  });
  listenerCleanups.push(cleanup);
  return cleanup;
});

type AuthResponse = {
  readonly data?: unknown;
  readonly error: {
    readonly status: number;
    readonly code?: string;
  } | null;
};

const sentWithoutCode: AuthResponse = {
  data: { status: true, signInCode: false },
  error: null,
};
const magicLink = mock((): Promise<AuthResponse> => {
  events.push("send");
  return Promise.resolve(sentWithoutCode);
});
const emailOtp = mock(
  (_body: {
    readonly email: string;
    readonly otp: string;
    readonly callbackURL: string;
  }): Promise<AuthResponse> =>
    Promise.resolve({ data: { token: "synthetic" }, error: null })
);
const recordSignInCompletion = mock((method: string) => {
  events.push(`record:${method}`);
});
const captureSignInCodeRejection = mock((reason: string) => {
  events.push(`rejected:${reason}`);
});
const getSession = mock(
  (
    _options?: SessionRequestOptions
  ): Promise<{ readonly data: SessionData | null; readonly error: null }> =>
    Promise.resolve({ data: null, error: null })
);

mock.module("@/shared/browser/return-window", () => ({ listenForReturn }));
mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession,
    signIn: { magicLink, emailOtp },
  },
}));
mock.module("./sign-in-analytics", () => ({
  captureSignInCodeRejection,
  recordSignInCompletion,
}));

let originalBroadcastChannel: PropertyDescriptor | undefined;
let originalCrypto: PropertyDescriptor | undefined;
let originalLocks: PropertyDescriptor | undefined;
let originalFocus: typeof window.focus;
let originalReplace: typeof window.location.replace;

let authReturn: typeof import("./auth-return");

const installReturnApis = () => {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: class TestBroadcastChannel {},
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: () => Promise.resolve() },
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => VALID_ATTEMPT_ID },
  });
};

const removeReturnApis = () => {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
};

const restoreProperty = (
  object: typeof globalThis | Navigator,
  property: string,
  descriptor: PropertyDescriptor | undefined
) => {
  if (descriptor) Object.defineProperty(object, property, descriptor);
  else Reflect.deleteProperty(object, property);
};

const setSession = (data: SessionData | null) => {
  getSession.mockResolvedValue({ data, error: null });
};

describe("account auth return lifecycle", () => {
  beforeAll(async () => {
    GlobalRegistrator.register();
    originalBroadcastChannel = Object.getOwnPropertyDescriptor(
      globalThis,
      "BroadcastChannel"
    );
    originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    originalFocus = window.focus;
    originalReplace = window.location.replace;
    authReturn = await import("./auth-return");
  });

  beforeEach(() => {
    installReturnApis();
    events.length = 0;
    listener = undefined;
    listenerCleanups.length = 0;
    listenForReturn.mockClear();
    magicLink.mockClear();
    magicLink.mockImplementation(() => {
      events.push("send");
      return Promise.resolve(sentWithoutCode);
    });
    emailOtp.mockClear();
    emailOtp.mockImplementation(() =>
      Promise.resolve({ data: { token: "synthetic" }, error: null })
    );
    recordSignInCompletion.mockClear();
    captureSignInCodeRejection.mockClear();
    getSession.mockClear();
    getSession.mockImplementation(() =>
      Promise.resolve({ data: null, error: null })
    );
    window.location.replace = ((href: string) => {
      events.push(`replace:${href}`);
    }) as typeof window.location.replace;
    window.focus = (() => {
      events.push("focus");
    }) as typeof window.focus;
  });

  afterEach(() => {
    for (const cleanup of listenerCleanups) cleanup.mockClear();
    window.location.replace = originalReplace;
    window.focus = originalFocus;
    restoreProperty(globalThis, "BroadcastChannel", originalBroadcastChannel);
    restoreProperty(globalThis, "crypto", originalCrypto);
    restoreProperty(navigator, "locks", originalLocks);
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("correlates the listener with the sign-in callback before sending", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });

    await lifecycle.sendSignInEmail(customerEmail);

    expect(events.slice(0, 2)).toEqual(["listen", "send"]);
    expect(listener?.attemptId).toBe(VALID_ATTEMPT_ID);
    expect(magicLink).toHaveBeenCalledWith({
      email: customerEmail,
      callbackURL: `/en-US/auth/callback?attempt=${VALID_ATTEMPT_ID}`,
      metadata: { locale: "en-US" },
    });
    lifecycle.cancel();
    expect(events).toContain("cleanup");
  });

  describe("with a return target", () => {
    const returnTo = "/cs-CZ/admin/invoices?page=2";
    const encodedReturnTo = "%2Fcs-CZ%2Fadmin%2Finvoices%3Fpage%3D2";
    const signedIn = () =>
      setSession({
        session: { createdAt: new Date() },
        user: { emailVerified: true },
      });

    test("carries it through the link callback and the hand-off", async () => {
      signedIn();
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
        returnTo,
      });
      await lifecycle.sendSignInEmail(customerEmail);

      expect(magicLink).toHaveBeenCalledWith({
        email: customerEmail,
        callbackURL: `/en-US/auth/callback?attempt=${VALID_ATTEMPT_ID}&returnTo=${encodedReturnTo}`,
        metadata: { locale: "en-US" },
      });
      expect(await listener?.onReturn(new AbortController().signal)).toBe(true);
      expect(events.slice(-2)).toEqual([`replace:${returnTo}`, "focus"]);
    });

    test("carries it without browser coordination", async () => {
      removeReturnApis();
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "cs-CZ",
        returnTo: "/admin",
      });

      await lifecycle.sendSignInEmail(customerEmail);

      expect(magicLink).toHaveBeenCalledWith({
        email: customerEmail,
        callbackURL: "/cs-CZ/auth/callback?returnTo=%2Fadmin",
        metadata: { locale: "cs-CZ" },
      });
    });

    test("continues through the callback carrying it after a verified code", async () => {
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
        returnTo,
      });
      await lifecycle.sendSignInEmail(customerEmail);
      await lifecycle.verifySignInCode(customerEmail, "482913");

      const callbackURL = `/en-US/auth/callback?attempt=${VALID_ATTEMPT_ID}&returnTo=${encodedReturnTo}`;
      expect(emailOtp).toHaveBeenCalledWith({
        email: customerEmail,
        otp: "482913",
        callbackURL,
      });
      expect(lifecycle.continueWithVerifiedCode()).toBe(true);
      expect(events.filter((event) => event.startsWith("replace:"))).toEqual([
        `replace:${callbackURL}`,
      ]);
    });

    test("continues to it when this browser is already signed in", async () => {
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
        returnTo,
      });
      await lifecycle.sendSignInEmail(customerEmail);
      signedIn();

      expect(await lifecycle.continueIfSignedIn()).toBe(true);
      expect(events).toContain(`replace:${returnTo}`);
    });

    test.each(unsafeReturnTargets)(
      "ignores %p and continues to the account",
      async (unsafeReturnTo) => {
        signedIn();
        const lifecycle = authReturn.createAuthReturnLifecycle({
          locale: "en-US",
          returnTo: unsafeReturnTo,
        });
        await lifecycle.sendSignInEmail(customerEmail);

        expect(magicLink).toHaveBeenCalledWith({
          email: customerEmail,
          callbackURL: `/en-US/auth/callback?attempt=${VALID_ATTEMPT_ID}`,
          metadata: { locale: "en-US" },
        });
        expect(await listener?.onReturn(new AbortController().signal)).toBe(
          true
        );
        expect(events.slice(-2)).toEqual(["replace:/en-US/account", "focus"]);
      }
    );
  });

  test("disposes the listener on rejected, thrown, cancelled, and resent emails", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });

    magicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { status: 429 } })
    );
    await lifecycle.sendSignInEmail(customerEmail);
    expect(listenerCleanups[0]).toHaveBeenCalledTimes(1);

    magicLink.mockImplementationOnce(() =>
      Promise.reject(new Error("synthetic failure"))
    );
    expect(await lifecycle.sendSignInEmail(customerEmail)).toEqual({
      status: "failed",
      reason: "failed",
    });
    expect(listenerCleanups[1]).toHaveBeenCalledTimes(1);

    await lifecycle.sendSignInEmail(customerEmail);
    expect(listenerCleanups[2]).not.toHaveBeenCalled();
    await lifecycle.sendSignInEmail(customerEmail);
    expect(listenerCleanups[2]).toHaveBeenCalledTimes(1);
    lifecycle.cancel();
    expect(listenerCleanups[3]).toHaveBeenCalledTimes(1);
  });

  test("uses the ordinary callback when browser coordination is unavailable", async () => {
    removeReturnApis();
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "cs-CZ",
    });

    await lifecycle.sendSignInEmail(customerEmail);

    expect(listenForReturn).not.toHaveBeenCalled();
    expect(magicLink).toHaveBeenCalledWith({
      email: customerEmail,
      callbackURL: "/cs-CZ/auth/callback",
      metadata: { locale: "cs-CZ" },
    });
  });

  test("requires the fresh authoritative session for deletion reauthentication", async () => {
    setSession({
      session: {
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
      user: { emailVerified: true },
    });
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
      requireFreshSession: true,
    });
    await lifecycle.sendSignInEmail(customerEmail);

    expect(await listener?.onReturn(new AbortController().signal)).toBe(false);
    expect(events).not.toContain("replace:/en-US/account");
    expect(getSession).toHaveBeenCalledWith({
      fetchOptions: { cache: "no-store" },
      query: { disableCookieCache: true },
    });
    lifecycle.cancel();
  });

  test.each([
    null,
    {
      session: { createdAt: new Date() },
      user: { emailVerified: false },
    },
  ])("does not acknowledge an absent or unverified session", async (data) => {
    setSession(data);
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);

    expect(await listener?.onReturn(new AbortController().signal)).toBe(false);
    expect(events).not.toContain("replace:/en-US/account");
    lifecycle.cancel();
  });

  test("requests hard navigation and focuses only after a verified session", async () => {
    setSession({
      session: { createdAt: new Date() },
      user: { emailVerified: true },
    });
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);

    expect(await listener?.onReturn(new AbortController().signal)).toBe(true);
    expect(events.slice(-2)).toEqual(["replace:/en-US/account", "focus"]);
    lifecycle.cancel();
  });

  test("does not acknowledge when hard navigation cannot be requested", async () => {
    setSession({
      session: { createdAt: new Date() },
      user: { emailVerified: true },
    });
    window.location.replace = (() => {
      throw new Error("navigation blocked");
    }) as typeof window.location.replace;
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);

    expect(await listener?.onReturn(new AbortController().signal)).toBe(false);
    expect(events).not.toContain("focus");
    lifecycle.cancel();
  });

  test("does not navigate or acknowledge when the return signal aborts during the session read", async () => {
    let resolveSession!: (response: {
      readonly data: SessionData;
      readonly error: null;
    }) => void;
    getSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        })
    );
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);

    const controller = new AbortController();
    const returnResult = listener?.onReturn(controller.signal);
    controller.abort();
    resolveSession({
      data: {
        session: { createdAt: new Date() },
        user: { emailVerified: true },
      },
      error: null,
    });

    expect(await returnResult).toBe(false);
    expect(events).not.toContain("replace:/en-US/account");
    lifecycle.cancel();
  });

  test("reports whether the sign-in email carries a code", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });

    expect(await lifecycle.sendSignInEmail(customerEmail)).toEqual({
      status: "sent",
      signInCode: false,
    });
    magicLink.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: true, signInCode: true }, error: null })
    );
    expect(await lifecycle.sendSignInEmail(customerEmail)).toEqual({
      status: "sent",
      signInCode: true,
    });
    lifecycle.cancel();
  });

  test("reports a send that a cancel or a later send replaced as cancelled", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    const pendingResponses: ((response: AuthResponse) => void)[] = [];
    magicLink.mockImplementation(
      () =>
        new Promise<AuthResponse>((resolve) => {
          pendingResponses.push(resolve);
        })
    );
    const settle = (index: number) =>
      pendingResponses[index]?.({
        data: { status: true, signInCode: true },
        error: null,
      });

    const cancelled = lifecycle.sendSignInEmail(customerEmail);
    lifecycle.cancel();
    settle(0);
    expect(await cancelled).toEqual({ status: "cancelled" });

    const superseded = lifecycle.sendSignInEmail(customerEmail);
    const latest = lifecycle.sendSignInEmail(customerEmail);
    settle(2);
    settle(1);
    expect(await latest).toEqual({ status: "sent", signInCode: true });
    expect(await superseded).toEqual({ status: "cancelled" });
    expect(listenerCleanups[2]).not.toHaveBeenCalled();
    lifecycle.cancel();
  });

  test.each([
    [{ status: 429, code: "SIGN_IN_EMAIL_LIMIT_REACHED" }, "address-limit"],
    [{ status: 429 }, "rate-limited"],
    [{ status: 403, code: "BOT_DETECTED" }, "failed"],
    [{ status: 503 }, "failed"],
    [{ status: 400, code: "INVALID_EMAIL" }, "failed"],
  ] as const)(
    "classifies a rejected sign-in email %o as %s",
    async (error, reason) => {
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
      });
      magicLink.mockImplementationOnce(() => Promise.resolve({ error }));

      expect(await lifecycle.sendSignInEmail(customerEmail)).toEqual({
        status: "failed",
        reason,
      });
      expect(listenerCleanups[0]).toHaveBeenCalledTimes(1);
    }
  );

  test("verifies a code against the latest email's callback URL", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "cs-CZ",
    });
    await lifecycle.sendSignInEmail(customerEmail);

    expect(await lifecycle.verifySignInCode(customerEmail, "482913")).toBe(
      "verified"
    );
    expect(emailOtp).toHaveBeenCalledWith({
      email: customerEmail,
      otp: "482913",
      callbackURL: `/cs-CZ/auth/callback?attempt=${VALID_ATTEMPT_ID}`,
    });
    // The verified code ends the link hand-off.
    expect(listenerCleanups[0]).toHaveBeenCalledTimes(1);
    expect(await listener?.onReturn(new AbortController().signal)).toBe(false);
  });

  test("verifies a restored code step against the plain callback", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });

    await lifecycle.verifySignInCode(customerEmail, "482913");

    expect(emailOtp).toHaveBeenCalledWith({
      email: customerEmail,
      otp: "482913",
      callbackURL: "/en-US/auth/callback",
    });
  });

  test.each([
    [{ status: 400, code: "INVALID_OTP" }, "wrong", "wrong"],
    [{ status: 400, code: "OTP_EXPIRED" }, "expired", "expired"],
    [
      { status: 403, code: "TOO_MANY_ATTEMPTS" },
      "too-many-attempts",
      "too_many_attempts",
    ],
  ] as const)(
    "maps the code rejection %o and reports it",
    async (error, verification, reason) => {
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
      });
      await lifecycle.sendSignInEmail(customerEmail);
      emailOtp.mockImplementationOnce(() =>
        Promise.resolve({ data: null, error })
      );

      expect(await lifecycle.verifySignInCode(customerEmail, "000000")).toBe(
        verification
      );
      expect(captureSignInCodeRejection).toHaveBeenCalledWith(reason);
      // A rejected code keeps the link hand-off alive.
      expect(listenerCleanups[0]).not.toHaveBeenCalled();
      expect(lifecycle.continueWithVerifiedCode()).toBe(false);
      lifecycle.cancel();
    }
  );

  test.each([
    { status: 403, code: "BOT_DETECTED" },
    { status: 429 },
    { status: 503 },
  ])("reports an unclassified code failure %o generically", async (error) => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    emailOtp.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error })
    );

    expect(await lifecycle.verifySignInCode(customerEmail, "482913")).toBe(
      "failed"
    );
    expect(captureSignInCodeRejection).not.toHaveBeenCalled();
  });

  test("reports a thrown code request generically", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    emailOtp.mockImplementationOnce(() =>
      Promise.reject(new Error("synthetic failure"))
    );

    expect(await lifecycle.verifySignInCode(customerEmail, "482913")).toBe(
      "failed"
    );
  });

  test("continues through the callback once after a verified code", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);
    await lifecycle.verifySignInCode(customerEmail, "482913");

    expect(lifecycle.continueWithVerifiedCode()).toBe(true);
    expect(lifecycle.continueWithVerifiedCode()).toBe(true);
    expect(await lifecycle.continueIfSignedIn()).toBe(true);

    expect(events.filter((event) => event.startsWith("replace:"))).toEqual([
      `replace:/en-US/auth/callback?attempt=${VALID_ATTEMPT_ID}`,
    ]);
    expect(recordSignInCompletion.mock.calls).toEqual([["code"]]);
  });

  test("records a link sign-in handed off to this tab, but not a reauthentication", async () => {
    setSession({
      session: { createdAt: new Date() },
      user: { emailVerified: true },
    });
    const signIn = authReturn.createAuthReturnLifecycle({ locale: "en-US" });
    await signIn.sendSignInEmail(customerEmail);
    expect(await listener?.onReturn(new AbortController().signal)).toBe(true);
    expect(recordSignInCompletion.mock.calls).toEqual([["link"]]);

    recordSignInCompletion.mockClear();
    const reauthentication = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
      requireFreshSession: true,
    });
    await reauthentication.sendSignInEmail(customerEmail);
    expect(await listener?.onReturn(new AbortController().signal)).toBe(true);
    expect(recordSignInCompletion).not.toHaveBeenCalled();
  });

  test("does not navigate twice when the link hand-off wins the race", async () => {
    setSession({
      session: { createdAt: new Date() },
      user: { emailVerified: true },
    });
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);
    let finishCodeSignIn!: (response: AuthResponse) => void;
    emailOtp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCodeSignIn = resolve;
        })
    );
    const verification = lifecycle.verifySignInCode(customerEmail, "482913");

    expect(await listener?.onReturn(new AbortController().signal)).toBe(true);
    finishCodeSignIn({ data: { token: "synthetic" }, error: null });
    expect(await verification).toBe("verified");
    expect(lifecycle.continueWithVerifiedCode()).toBe(true);
    expect(await lifecycle.continueIfSignedIn()).toBe(true);

    expect(events.filter((event) => event.startsWith("replace:"))).toEqual([
      "replace:/en-US/account",
    ]);
  });

  test("continues to the account only when this browser is signed in", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);

    expect(await lifecycle.continueIfSignedIn()).toBe(false);
    expect(events).not.toContain("replace:/en-US/account");

    setSession({
      session: { createdAt: new Date() },
      user: { emailVerified: true },
    });
    expect(await lifecycle.continueIfSignedIn()).toBe(true);
    expect(events).toContain("replace:/en-US/account");
    // The other tab finished the sign-in and records it itself.
    expect(recordSignInCompletion).not.toHaveBeenCalled();
    expect(listenerCleanups[0]).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["a cancel", (lifecycle: AuthReturnLifecycle) => lifecycle.cancel()],
    [
      "a newer email",
      (lifecycle: AuthReturnLifecycle) =>
        void lifecycle.sendSignInEmail(customerEmail),
    ],
  ])("drops a session check that %s overtook", async (_label, overtake) => {
    let finishSessionRead!: (data: SessionData) => void;
    getSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSessionRead = (data) => resolve({ data, error: null });
        })
    );
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });

    const continuation = lifecycle.continueIfSignedIn();
    overtake(lifecycle);
    finishSessionRead({
      session: { createdAt: new Date() },
      user: { emailVerified: true },
    });

    expect(await continuation).toBe(false);
    expect(events).not.toContain("replace:/en-US/account");
  });

  test("treats a failed session read as signed out", async () => {
    getSession.mockImplementationOnce(() =>
      Promise.reject(new Error("synthetic failure"))
    );
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });

    expect(await lifecycle.continueIfSignedIn()).toBe(false);
  });

  test("forgets a pending code step once a link hand-off signs this tab in", async () => {
    sessionStorage.setItem(
      "deskohub:account-sign-in-code",
      JSON.stringify({ email: customerEmail, requestedAt: Date.now() })
    );
    setSession({
      session: { createdAt: new Date() },
      user: { emailVerified: true },
    });
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);

    expect(await listener?.onReturn(new AbortController().signal)).toBe(true);
    expect(sessionStorage.getItem("deskohub:account-sign-in-code")).toBeNull();
  });
});
