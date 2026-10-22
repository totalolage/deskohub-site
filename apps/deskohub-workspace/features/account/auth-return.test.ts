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
import {
  encodeAuthCallbackReturn,
  readAuthCallbackReturnTo,
  signInCallbackReturnParam,
} from "./routes";

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
const magicLink = mock(
  (_body?: { readonly callbackURL: string }): Promise<AuthResponse> => {
    events.push("send");
    return Promise.resolve(sentWithoutCode);
  }
);
const emailOtp = mock(
  (_body: {
    readonly email: string;
    readonly otp: string;
    readonly callbackURL: string;
  }): Promise<AuthResponse> =>
    Promise.resolve({ data: { token: "synthetic" }, error: null })
);
const passwordStep: AuthResponse = {
  data: { status: true, method: "password" },
  error: null,
};
const passwordSignIn = mock(
  (_body: {
    readonly email: string;
    readonly password: string;
    readonly callbackURL: string;
  }): Promise<AuthResponse> =>
    Promise.resolve({
      data: { redirect: false, token: "synthetic" },
      error: null,
    })
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
    signIn: { magicLink, emailOtp, email: passwordSignIn },
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
    passwordSignIn.mockClear();
    passwordSignIn.mockImplementation(() =>
      Promise.resolve({
        data: { redirect: false, token: "synthetic" },
        error: null,
      })
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

  describe("for a review login", () => {
    test("stops the link hand-off and signs in with the password against the plain callback", async () => {
      magicLink.mockImplementationOnce(() => Promise.resolve(passwordStep));
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "cs-CZ",
      });

      expect(await lifecycle.sendSignInEmail(customerEmail)).toEqual({
        status: "password",
      });
      expect(listenerCleanups[0]).toHaveBeenCalledTimes(1);
      expect(
        await lifecycle.signInWithPassword(customerEmail, "synthetic-password")
      ).toBe("signed-in");
      expect(passwordSignIn).toHaveBeenCalledWith({
        email: customerEmail,
        password: "synthetic-password",
        callbackURL: "/cs-CZ/auth/callback",
      });
      expect(events.some((event) => event.startsWith("replace:"))).toBe(false);

      expect(lifecycle.continueWithPassword()).toBe(true);
      expect(events.filter((event) => event.startsWith("replace:"))).toEqual([
        "replace:/cs-CZ/auth/callback",
      ]);
      expect(recordSignInCompletion).not.toHaveBeenCalled();
    });

    test.each([
      [{ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, "wrong"],
      [{ status: 429 }, "rate-limited"],
      [{ status: 403, code: "BOT_DETECTED" }, "automated"],
      [{ status: 500 }, "failed"],
    ] as const)(
      "maps a rejected password sign-in %p to %p and stays",
      async (error, outcome) => {
        passwordSignIn.mockImplementationOnce(() => Promise.resolve({ error }));
        const lifecycle = authReturn.createAuthReturnLifecycle({
          locale: "en-US",
        });

        expect(
          await lifecycle.signInWithPassword(
            customerEmail,
            "synthetic-password"
          )
        ).toBe(outcome);
        expect(lifecycle.continueWithPassword()).toBe(false);
        expect(events.some((event) => event.startsWith("replace:"))).toBe(
          false
        );
      }
    );
  });

  describe("with a return target", () => {
    const returnTo = "/cs-CZ/admin/invoices?page=2";
    // Base64url, so Better Auth's second decode of the link's callback
    // keeps the nested query.
    const encodedReturnTo = encodeAuthCallbackReturn(returnTo);
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
        callbackURL: `/en-US/auth/callback?attempt=${VALID_ATTEMPT_ID}&return=${encodedReturnTo}`,
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
        callbackURL: `/cs-CZ/auth/callback?return=${encodeAuthCallbackReturn("/admin")}`,
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

      const callbackURL = `/en-US/auth/callback?attempt=${VALID_ATTEMPT_ID}&return=${encodedReturnTo}`;
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
      attemptId: VALID_ATTEMPT_ID,
    });
    magicLink.mockImplementationOnce(() =>
      Promise.resolve({ data: { status: true, signInCode: true }, error: null })
    );
    expect(await lifecycle.sendSignInEmail(customerEmail)).toEqual({
      status: "sent",
      signInCode: true,
      attemptId: VALID_ATTEMPT_ID,
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
    expect(await latest).toEqual({
      status: "sent",
      signInCode: true,
      attemptId: VALID_ATTEMPT_ID,
    });
    expect(await superseded).toEqual({ status: "cancelled" });
    expect(listenerCleanups[2]).not.toHaveBeenCalled();
    lifecycle.cancel();
  });

  test.each([
    [{ status: 429, code: "SIGN_IN_EMAIL_LIMIT_REACHED" }, "address-limit"],
    [{ status: 429 }, "rate-limited"],
    [{ status: 403, code: "BOT_DETECTED" }, "automated"],
    [{ status: 429, code: "BOT_DETECTED" }, "automated"],
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

  test("maps a BotID code rejection without capturing it as a code error", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });
    await lifecycle.sendSignInEmail(customerEmail);
    emailOtp.mockImplementationOnce(() =>
      Promise.resolve({
        data: null,
        error: { status: 403, code: "BOT_DETECTED" },
      })
    );

    expect(await lifecycle.verifySignInCode(customerEmail, "000000")).toBe(
      "automated"
    );
    expect(captureSignInCodeRejection).not.toHaveBeenCalled();
    expect(listenerCleanups[0]).not.toHaveBeenCalled();
    lifecycle.cancel();
  });

  test.each([
    { status: 403, code: "UNKNOWN_ERROR" },
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
  describe("with a return path the verify page continues", () => {
    const returnTo = "/en-US/reservation?date=2026-10-20&contact=a.b-c";
    const signedIn = () =>
      setSession({
        session: { createdAt: new Date() },
        user: { emailVerified: true },
      });
    const callbackReturnTo = (callbackURL: string | undefined) =>
      readAuthCallbackReturnTo(
        new URL(callbackURL ?? "", "https://site.invalid").searchParams.get(
          signInCallbackReturnParam
        )
      );
    const sentCallbackURL = () =>
      magicLink.mock.calls.at(-1)?.[0]?.callbackURL ?? "";

    beforeEach(() => {
      sessionStorage.clear();
    });

    afterEach(async () => {
      const { rememberEmailSignInRequest } = await import(
        "./email-sign-in-request"
      );
      rememberEmailSignInRequest(null);
    });

    test("keeps a nested query through a second decode of the callback", async () => {
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
        returnTo,
      });

      await lifecycle.sendSignInEmail(customerEmail);

      expect(callbackReturnTo(sentCallbackURL())).toBe(returnTo);
      // Better Auth's link verification decodes the callback once more.
      expect(callbackReturnTo(decodeURIComponent(sentCallbackURL()))).toBe(
        returnTo
      );
      lifecycle.cancel();
    });

    test("resumes an email sent from another page of this tab", async () => {
      signedIn();
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
        returnTo,
      });

      lifecycle.resumeSignInEmail({ attemptId: VALID_ATTEMPT_ID });

      expect(magicLink).not.toHaveBeenCalled();
      expect(listener?.attemptId).toBe(VALID_ATTEMPT_ID);
      await lifecycle.verifySignInCode(customerEmail, "482913");
      const callbackURL = emailOtp.mock.calls[0]?.[0].callbackURL;
      expect(
        new URL(callbackURL ?? "", "https://site.invalid").searchParams.get(
          "attempt"
        )
      ).toBe(VALID_ATTEMPT_ID);
      expect(callbackReturnTo(callbackURL)).toBe(returnTo);
      expect(listenerCleanups[0]).toHaveBeenCalledTimes(1);
    });

    test("resumes without a hand-off when the request has no attempt", () => {
      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
        returnTo,
      });

      lifecycle.resumeSignInEmail({});

      expect(listenForReturn).not.toHaveBeenCalled();
    });

    test("stores a sent email for the verify page and releases its listener", async () => {
      const result = await authReturn.startEmailSignIn({
        locale: "en-US",
        email: customerEmail,
        returnTo,
      });

      expect(result).toEqual({
        status: "sent",
        signInCode: false,
        attemptId: VALID_ATTEMPT_ID,
      });
      expect(callbackReturnTo(sentCallbackURL())).toBe(returnTo);
      expect(listenerCleanups[0]).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(
          sessionStorage.getItem("deskohub:account-sign-in-code") ?? ""
        )
      ).toMatchObject({
        email: customerEmail,
        signInCode: false,
        attemptId: VALID_ATTEMPT_ID,
        returnTo,
      });
    });

    test("stores a review login's password step for the verify page", async () => {
      magicLink.mockImplementationOnce(() => Promise.resolve(passwordStep));

      expect(
        await authReturn.startEmailSignIn({
          locale: "en-US",
          email: customerEmail,
          returnTo,
        })
      ).toEqual({ status: "password" });
      expect(
        JSON.parse(
          sessionStorage.getItem("deskohub:account-sign-in-code") ?? ""
        )
      ).toMatchObject({ email: customerEmail, method: "password", returnTo });

      const lifecycle = authReturn.createAuthReturnLifecycle({
        locale: "en-US",
        returnTo,
      });
      lifecycle.resumeSignInEmail({});
      await lifecycle.signInWithPassword(customerEmail, "synthetic-password");
      expect(
        callbackReturnTo(passwordSignIn.mock.calls[0]?.[0].callbackURL)
      ).toBe(returnTo);
    });

    test("stores nothing when the email could not be sent", async () => {
      magicLink.mockImplementationOnce(() =>
        Promise.resolve({ error: { status: 429 } })
      );

      expect(
        await authReturn.startEmailSignIn({
          locale: "en-US",
          email: customerEmail,
          returnTo,
        })
      ).toEqual({ status: "failed", reason: "rate-limited" });
      expect(
        sessionStorage.getItem("deskohub:account-sign-in-code")
      ).toBeNull();
    });

    test.each([
      [
        "a path longer than a return path may be",
        `/en-US/cowork?contact=${"c".repeat(8 * 1024)}`,
      ],
      ["another origin", "https://evil.example/en-US/cowork"],
    ])(
      "sends nothing for %s instead of dropping where it continues",
      async (_case, rejectedReturnTo) => {
        expect(
          await authReturn.startEmailSignIn({
            locale: "en-US",
            email: customerEmail,
            returnTo: rejectedReturnTo,
          })
        ).toEqual({ status: "failed", reason: "invalid-return-path" });
        expect(magicLink).not.toHaveBeenCalled();
        expect(listenForReturn).not.toHaveBeenCalled();
        expect(
          sessionStorage.getItem("deskohub:account-sign-in-code")
        ).toBeNull();
      }
    );
  });
});
