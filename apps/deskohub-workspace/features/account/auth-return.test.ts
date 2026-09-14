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

const magicLink = mock(() => {
  events.push("send");
  return Promise.resolve({ error: null });
});
const getSession = mock((_options?: SessionRequestOptions) =>
  Promise.resolve({ data: null, error: null })
);

mock.module("@/shared/browser/return-window", () => ({ listenForReturn }));
mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession,
    signIn: { magicLink },
  },
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
      return Promise.resolve({ error: null });
    });
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

  test("correlates the listener with the magic-link callback before sending", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });

    await lifecycle.sendMagicLink("ada@example.test");

    expect(events.slice(0, 2)).toEqual(["listen", "send"]);
    expect(listener?.attemptId).toBe(VALID_ATTEMPT_ID);
    expect(magicLink).toHaveBeenCalledWith({
      email: "ada@example.test",
      callbackURL: `/en-US/auth/callback?attempt=${VALID_ATTEMPT_ID}`,
      metadata: { locale: "en-US" },
    });
    lifecycle.cancel();
    expect(events).toContain("cleanup");
  });

  test("disposes the listener on rejected, thrown, cancelled, and resent requests", async () => {
    const lifecycle = authReturn.createAuthReturnLifecycle({
      locale: "en-US",
    });

    magicLink.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "rate limited" } })
    );
    await lifecycle.sendMagicLink("ada@example.test");
    expect(listenerCleanups[0]).toHaveBeenCalledTimes(1);

    magicLink.mockImplementationOnce(() =>
      Promise.reject(new Error("synthetic failure"))
    );
    await expect(lifecycle.sendMagicLink("ada@example.test")).rejects.toThrow(
      "synthetic failure"
    );
    expect(listenerCleanups[1]).toHaveBeenCalledTimes(1);

    await lifecycle.sendMagicLink("ada@example.test");
    expect(listenerCleanups[2]).not.toHaveBeenCalled();
    await lifecycle.sendMagicLink("ada@example.test");
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

    await lifecycle.sendMagicLink("ada@example.test");

    expect(listenForReturn).not.toHaveBeenCalled();
    expect(magicLink).toHaveBeenCalledWith({
      email: "ada@example.test",
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
    await lifecycle.sendMagicLink("ada@example.test");

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
    await lifecycle.sendMagicLink("ada@example.test");

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
    await lifecycle.sendMagicLink("ada@example.test");

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
    await lifecycle.sendMagicLink("ada@example.test");

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
    await lifecycle.sendMagicLink("ada@example.test");

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
});
