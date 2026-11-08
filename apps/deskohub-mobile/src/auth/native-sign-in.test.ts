import { describe, expect, spyOn, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Option } from "effect";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { nativeReturnUri, parseAuthCallbackUrl } from "./auth-callback";
import { AuthCallbackCompletions } from "./auth-callback-completions.service";
import { AuthCrypto } from "./auth-crypto.service";
import {
  AuthSessionBrowser,
  AuthSessionResult,
  AuthSessionUnavailable,
  customTabsBrowserPackage,
} from "./auth-session-browser.service";
import {
  type MemorySecureStore,
  makeMemorySecureStore,
} from "./memory-secure-store";
import { NativeAuth } from "./native-auth.service";
import { createNativeAuthClient } from "./native-auth-client";
import { readNativeHandoffRequest } from "./native-handoff-request";
import {
  completeAuthCallback,
  reauthenticate,
  signInFailureOf,
  signInWithEmail,
  startPendingSignIn,
} from "./native-sign-in";
import { PendingSignIns, pendingSignInKey } from "./pending-sign-in.service";
import { SignInLocale } from "./sign-in-locale";
import {
  type FakeAuthServer,
  type FakeUser,
  makeFakeAuthServer,
} from "./testing/fake-auth-server";

const origin = "https://workspace.deskohub.cz";
const ada: FakeUser = { id: "user-ada", email: testEmailAddress("ada") };
const bob: FakeUser = { id: "user-bob", email: testEmailAddress("bob") };

type WebPage = (url: string) => Promise<AuthSessionResult>;

/**
 * One app process: a fresh Better Auth Expo client and completion registry
 * over `store`, which outlives it like SecureStore does.
 */
const launchApp = (
  server: FakeAuthServer,
  store: MemorySecureStore,
  webPage: WebPage = async () => AuthSessionResult.Closed()
) => {
  const options = { origin, storage: store, fetch: server.fetch };
  const client = createNativeAuthClient(options);
  const opened: Array<string> = [];
  const browser = Layer.succeed(AuthSessionBrowser, {
    open: (url, returnUri) => {
      expect(returnUri).toBe(nativeReturnUri);
      opened.push(url);
      return Effect.promise(() => webPage(url));
    },
    dismiss: Effect.void,
  });
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      NativeAuth.fromClient(client, options),
      PendingSignIns.fromStore(store),
      AuthCrypto.Live,
      AuthCallbackCompletions.Default,
      browser,
      Layer.succeed(SignInLocale, "cs-CZ")
    )
  );
  return { client, runtime, opened };
};

/** The web sign-in page: `user` signs in there and the page mints. */
const webSignInAs =
  (server: FakeAuthServer, user: FakeUser): WebPage =>
  async (url) => {
    const request = readNativeHandoffRequest(new URL(url).searchParams, origin);
    if (Option.isNone(request)) throw new Error("bad native sign-in URL");
    return AuthSessionResult.Returned({
      url: server.mintHandoff(user, request.value),
    });
  };

const failureTag = (exit: Exit.Exit<unknown, { readonly _tag: string }>) =>
  Option.getOrUndefined(signInFailureOf(exit as never))?._tag;

const storedCookie = (store: MemorySecureStore) =>
  store.values.get("deskohub_cookie") ?? "";

/** How often the client told `useSession` its session changed. */
const sessionSignals = (client: ReturnType<typeof launchApp>["client"]) => {
  let count = 0;
  client.$store.atoms.$sessionSignal?.listen(() => {
    count += 1;
  });
  return () => count;
};

describe("native session store", () => {
  test("a verified magic link stores the session cookie", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const app = launchApp(server, store);
    const signals = sessionSignals(app.client);

    const user = await app.runtime.runPromise(
      completeAuthCallback({
        kind: "token",
        token: server.issueMagicLink(ada),
      })
    );

    expect(user).toEqual(ada);
    expect(storedCookie(store)).toContain("better-auth.session_token");
    expect(signals()).toBeGreaterThan(0);
    expect((await app.client.getSession()).data?.user.id).toBe(ada.id);
    // Amendment A: the app verifies with the token alone.
    expect(
      server.callsTo("/magic-link/verify").map((call) => call.query)
    ).toEqual([["token"]]);
  });

  test("a magic-link verification names the locale the app shows", async () => {
    const server = makeFakeAuthServer(origin);
    const app = launchApp(server, makeMemorySecureStore());

    await app.runtime.runPromise(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(ada) })
    );
    await app.runtime.runPromise(
      completeAuthCallback({
        kind: "token",
        token: server.issueMagicLink(ada),
      }).pipe(Effect.provideService(SignInLocale, "en-US"))
    );

    expect(
      server.callsTo("/magic-link/verify").map((call) => call.locale)
    ).toEqual(["cs-CZ", "en-US"]);
    // Only the requests that can create an account name it.
    expect(
      server.calls
        .filter((call) => call.locale !== undefined)
        .map((call) => call.path)
    ).toEqual(["/magic-link/verify", "/magic-link/verify"]);
  });

  test("a new client on the same storage restores the session", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const first = launchApp(server, store);
    await first.runtime.runPromise(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(ada) })
    );
    await first.runtime.dispose();

    const restarted = launchApp(server, store);
    const session = await restarted.client.getSession();
    expect(session.data?.user.id).toBe(ada.id);
    const user = await restarted.runtime.runPromise(
      Effect.service(NativeAuth).pipe(
        Effect.flatMap((auth) => auth.currentUser)
      )
    );
    expect(user).toEqual(Option.some(ada));
  });

  test("signing out clears the stored session", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const app = launchApp(server, store);
    await app.runtime.runPromise(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(ada) })
    );

    await app.runtime.runPromise(
      Effect.service(NativeAuth).pipe(Effect.flatMap((auth) => auth.signOut))
    );

    expect(storedCookie(store)).not.toContain("session_token");
    expect(server.openSessions()).toEqual([]);
    const restarted = launchApp(server, store);
    expect((await restarted.client.getSession()).data).toBeNull();
  });

  test("an interrupted sign-in finishes storing the session it accepted", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writing = false;
    const write = store.setItemAsync;
    store.setItemAsync = async (key, value) => {
      if (key === "deskohub_cookie") {
        writing = true;
        await gate;
      }
      await write(key, value);
    };
    const app = launchApp(server, store);
    const signals = sessionSignals(app.client);

    const signIn = app.runtime.runFork(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(ada) })
    );
    while (!writing) await Bun.sleep(1);
    const interrupted = app.runtime.runPromise(Fiber.interrupt(signIn));
    release();
    await interrupted;

    expect(storedCookie(store)).toContain("session_token");
    expect(signals()).toBeGreaterThan(0);
  });

  test("a used magic link is refused", async () => {
    const server = makeFakeAuthServer(origin);
    const app = launchApp(server, makeMemorySecureStore());
    const token = server.issueMagicLink(ada);
    await app.runtime.runPromise(
      completeAuthCallback({ kind: "token", token })
    );

    const again = launchApp(server, makeMemorySecureStore());
    const exit = await again.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token })
    );
    expect(failureTag(exit)).toBe("SignInRejected");
  });
});

describe("native email sign-in through the auth session", () => {
  test("redeems the handoff code with the stored verifier", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const app = launchApp(server, store, webSignInAs(server, ada));
    const signals = sessionSignals(app.client);

    const user = await app.runtime.runPromise(signInWithEmail(Option.none()));

    expect(user).toEqual(ada);
    expect(server.callsTo("/native-handoff/exchange")).toHaveLength(1);
    expect(store.values.has(pendingSignInKey)).toBe(false);
    expect(storedCookie(store)).toContain("session_token");
    expect(signals()).toBeGreaterThan(0);
    expect((await app.client.getSession()).data?.user.id).toBe(ada.id);
    const signInUrl = new URL(app.opened[0] ?? "");
    expect(signInUrl.origin + signInUrl.pathname).toBe(`${origin}/app/sign-in`);
    expect(signInUrl.searchParams.has("prompt")).toBe(false);
  });

  test("refuses a handoff with the wrong state without calling the server", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const app = launchApp(server, store);
    const request = await app.runtime.runPromise(
      startPendingSignIn(Option.none())
    );
    const minted = new URL(server.mintHandoff(ada, request));

    const exit = await app.runtime.runPromiseExit(
      completeAuthCallback({
        kind: "handoff",
        code: minted.searchParams.get("code") ?? "",
        state: `${request.state}x`,
      })
    );

    expect(failureTag(exit)).toBe("SignInLinkRefused");
    expect(server.callsTo("/native-handoff/exchange")).toEqual([]);
    // The attempt in progress survives a stray link.
    expect(store.values.has(pendingSignInKey)).toBe(true);
  });

  test("refuses a handoff when no sign-in is pending", async () => {
    const server = makeFakeAuthServer(origin);
    const app = launchApp(server, makeMemorySecureStore());
    const exit = await app.runtime.runPromiseExit(
      completeAuthCallback(
        parseAuthCallbackUrl(
          `${nativeReturnUri}?code=c&state=${"s".repeat(43)}`
        )
      )
    );
    expect(failureTag(exit)).toBe("SignInLinkRefused");
    expect(server.callsTo("/native-handoff/exchange")).toEqual([]);
  });

  test("finishes after a cold start from the stored attempt", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const first = launchApp(server, store);
    const request = await first.runtime.runPromise(
      startPendingSignIn(Option.none())
    );
    const callbackUrl = server.mintHandoff(ada, request);
    await first.runtime.dispose();

    const coldStart = launchApp(server, store);
    const user = await coldStart.runtime.runPromise(
      completeAuthCallback(parseAuthCallbackUrl(callbackUrl))
    );
    expect(user).toEqual(ada);
  });

  test("completes once when the route and the auth session both see the callback", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    let routeUrl = "";
    // Android: the callback reaches the router while the session resolves
    // `dismiss`.
    const app = launchApp(server, store, async (url) => {
      const result = await webSignInAs(server, ada)(url);
      if (result._tag === "Returned") routeUrl = result.url;
      return AuthSessionResult.Closed();
    });

    const flow = app.runtime.runPromise(signInWithEmail(Option.none()));
    while (routeUrl === "") await Bun.sleep(1);
    const [fromRoute, again] = await Promise.all([
      app.runtime.runPromise(
        completeAuthCallback(parseAuthCallbackUrl(routeUrl))
      ),
      app.runtime.runPromise(
        completeAuthCallback(parseAuthCallbackUrl(routeUrl))
      ),
    ]);

    expect(await flow).toEqual(ada);
    expect(fromRoute).toEqual(ada);
    expect(again).toEqual(ada);
    expect(server.callsTo("/native-handoff/exchange")).toHaveLength(1);
  });

  test("waits for a slow exchange once the callback has arrived", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    let release: () => void = () => undefined;
    server.holdExchanges(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    let routeUrl = "";
    const app = launchApp(server, store, async (url) => {
      const result = await webSignInAs(server, ada)(url);
      if (result._tag === "Returned") routeUrl = result.url;
      return AuthSessionResult.Closed();
    });

    const flow = app.runtime.runPromiseExit(signInWithEmail(Option.none()));
    while (routeUrl === "") await Bun.sleep(1);
    const route = app.runtime.runPromise(
      completeAuthCallback(parseAuthCallbackUrl(routeUrl))
    );
    // Past the grace period for the callback's arrival.
    await Bun.sleep(3300);
    release();

    expect(await route).toEqual(ada);
    const exit = await flow;
    expect(Exit.isSuccess(exit) ? exit.value : failureTag(exit)).toEqual(ada);
  }, 10_000);

  test("a magic link opened from the mail app finishes the waiting attempt", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    let token = "";
    const app = launchApp(server, store, async () => {
      token = server.issueMagicLink(ada);
      return AuthSessionResult.Closed();
    });

    const flow = app.runtime.runPromise(signInWithEmail(Option.none()));
    while (token === "") await Bun.sleep(1);
    await app.runtime.runPromise(
      completeAuthCallback({ kind: "token", token })
    );

    expect(await flow).toEqual(ada);
    expect(store.values.has(pendingSignInKey)).toBe(false);
  });
});

describe("auth session browser", () => {
  type Browsers = WebBrowser.WebBrowserCustomTabsResults;
  const opened = async (lookup: () => Promise<Browsers>) => {
    const browsers = spyOn(
      WebBrowser,
      "getCustomTabsSupportingBrowsersAsync"
    ).mockImplementation(lookup);
    const open = spyOn(WebBrowser, "openAuthSessionAsync");
    try {
      const exit = await Effect.runPromiseExit(
        Effect.service(AuthSessionBrowser).pipe(
          Effect.flatMap((browser) =>
            browser.open(
              "https://workspace.example.test/app/sign-in?native=1",
              "deskohub://auth/callback"
            )
          ),
          Effect.provide(AuthSessionBrowser.Live)
        )
      );
      return {
        exit,
        call: open.mock.calls[0],
        lookups: browsers.mock.calls.length,
      };
    } finally {
      open.mockRestore();
      browsers.mockRestore();
    }
  };
  const unavailable = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit) &&
    Option.match(Exit.findErrorOption(exit), {
      onNone: () => false,
      onSome: (error) => error instanceof AuthSessionUnavailable,
    });

  // The app claims its host's /app/ links, sign-in page included, and
  // Android hands an https link without a named package to that app before
  // any browser.
  test("picks the preferred, then the default, then any Custom Tabs browser", () => {
    expect(
      customTabsBrowserPackage({
        browserPackages: ["org.example.other", "com.android.chrome"],
        defaultBrowserPackage: "org.example.default",
        preferredBrowserPackage: "com.android.chrome",
        servicePackages: [],
      })
    ).toBe("com.android.chrome");
    expect(
      customTabsBrowserPackage({
        browserPackages: ["org.example.other", "org.example.default"],
        defaultBrowserPackage: "org.example.default",
        servicePackages: [],
      })
    ).toBe("org.example.default");
    expect(
      customTabsBrowserPackage({
        browserPackages: ["org.example.other"],
        servicePackages: [],
      })
    ).toBe("org.example.other");
    expect(
      customTabsBrowserPackage({ browserPackages: [], servicePackages: [] })
    ).toBeUndefined();
  });

  test("opens the sign-in page in the chosen Custom Tabs browser on Android", async () => {
    const { call } = await opened(async () => ({
      browserPackages: ["com.android.chrome"],
      preferredBrowserPackage: "com.android.chrome",
      servicePackages: ["com.android.chrome"],
    }));
    expect(call).toEqual([
      "https://workspace.example.test/app/sign-in?native=1",
      "deskohub://auth/callback",
      { browserPackage: "com.android.chrome", createTask: false },
    ]);
  });

  // Without a named browser the sign-in page would open in the app itself.
  test("fails as unavailable on Android when no Custom Tabs browser is known", async () => {
    const { exit, call } = await opened(async () => ({
      browserPackages: [],
      servicePackages: [],
    }));
    expect(unavailable(exit)).toBe(true);
    expect(call).toBeUndefined();
  });

  test("fails as unavailable on Android when the browser lookup fails", async () => {
    const { exit, call } = await opened(() =>
      Promise.reject(new Error("no package manager"))
    );
    expect(unavailable(exit)).toBe(true);
    expect(call).toBeUndefined();
  });

  test("lets iOS open its auth session without a browser lookup", async () => {
    const platform = Platform.OS;
    Object.assign(Platform, { OS: "ios" });
    try {
      const { call, lookups } = await opened(async () => ({
        browserPackages: ["com.android.chrome"],
        servicePackages: [],
      }));
      expect(lookups).toBe(0);
      expect(call).toEqual([
        "https://workspace.example.test/app/sign-in?native=1",
        "deskohub://auth/callback",
        undefined,
      ]);
    } finally {
      Object.assign(Platform, { OS: platform });
    }
  });

  test("closing is a no-op where the platform can't close the session", async () => {
    await expect(
      Effect.runPromise(
        Effect.service(AuthSessionBrowser).pipe(
          Effect.flatMap((browser) => browser.dismiss),
          Effect.provide(AuthSessionBrowser.Live)
        )
      )
    ).resolves.toBeUndefined();
  });
});

describe("reauthentication", () => {
  const signedInAs = async (
    server: FakeAuthServer,
    store: MemorySecureStore,
    user: FakeUser
  ) => {
    const app = launchApp(server, store);
    await app.runtime.runPromise(
      completeAuthCallback({
        kind: "token",
        token: server.issueMagicLink(user),
      })
    );
    await app.runtime.dispose();
    return storedCookie(store);
  };

  /** The app is still signed in to `user` with the cookie it had before. */
  const expectStillSignedIn = async (
    server: FakeAuthServer,
    store: MemorySecureStore,
    user: FakeUser,
    cookie: string
  ) => {
    expect(storedCookie(store)).toBe(cookie);
    expect(server.openSessions()).toContainEqual(user);
    const restarted = launchApp(server, store);
    expect((await restarted.client.getSession()).data?.user.id).toBe(user.id);
    await restarted.runtime.dispose();
  };

  test("asks the page to sign in again and keeps the same account", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const before = await signedInAs(server, store, ada);
    const app = launchApp(server, store, webSignInAs(server, ada));
    const signals = sessionSignals(app.client);

    const user = await app.runtime.runPromise(reauthenticate);

    expect(user).toEqual(ada);
    expect(new URL(app.opened[0] ?? "").searchParams.get("prompt")).toBe(
      "login"
    );
    // The app now holds the fresh session, not the one it started with.
    expect(storedCookie(store)).toContain("session_token");
    expect(storedCookie(store)).not.toBe(before);
    expect(signals()).toBeGreaterThan(0);
    expect((await app.client.getSession()).data?.user.id).toBe(ada.id);
  });

  test("refuses to switch to another account and stays signed in", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const adaCookie = await signedInAs(server, store, ada);
    const app = launchApp(server, store, webSignInAs(server, bob));

    const exit = await app.runtime.runPromiseExit(reauthenticate);

    expect(failureTag(exit)).toBe("AccountSwitchRefused");
    expect(server.openSessions()).not.toContainEqual(bob);
    expect((await app.client.getSession()).data?.user.id).toBe(ada.id);
    await expectStillSignedIn(server, store, ada, adaCookie);
  });

  test("refuses another account's handoff after a cold start and stays signed in", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const adaCookie = await signedInAs(server, store, ada);
    const first = launchApp(server, store);
    const request = await first.runtime.runPromise(
      startPendingSignIn(Option.some(ada.id))
    );
    const callbackUrl = server.mintHandoff(bob, request);
    await first.runtime.dispose();

    const coldStart = launchApp(server, store);
    const exit = await coldStart.runtime.runPromiseExit(
      completeAuthCallback(parseAuthCallbackUrl(callbackUrl))
    );

    expect(failureTag(exit)).toBe("AccountSwitchRefused");
    expect(server.openSessions()).not.toContainEqual(bob);
    await expectStillSignedIn(server, store, ada, adaCookie);
  });

  test("signs the new session out when its account can't be confirmed", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const adaCookie = await signedInAs(server, store, ada);
    server.failSessionReadsAfterExchange(100);
    const app = launchApp(server, store, webSignInAs(server, bob));

    const exit = await app.runtime.runPromiseExit(reauthenticate);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(server.openSessions()).toEqual([ada]);
    expect(storedCookie(store)).toBe(adaCookie);
  });

  test("keeps refusing the other account's links after a refusal", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const adaCookie = await signedInAs(server, store, ada);
    // The reauthentication email's link for Bob opens in the mail app while
    // the auth session waits, twice.
    const links: Array<string> = [];
    const app = launchApp(server, store, async () => {
      links.push(server.issueMagicLink(bob), server.issueMagicLink(bob));
      return AuthSessionResult.Closed();
    });
    const flow = app.runtime.runPromiseExit(reauthenticate);
    while (links.length === 0) await Bun.sleep(1);

    const [first, second] = links;
    const firstExit = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: first ?? "" })
    );
    const secondExit = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: second ?? "" })
    );

    expect(failureTag(firstExit)).toBe("AccountSwitchRefused");
    expect(failureTag(secondExit)).toBe("AccountSwitchRefused");
    expect(failureTag(await flow)).toBe("AccountSwitchRefused");
    expect(server.openSessions()).not.toContainEqual(bob);
    await expectStillSignedIn(server, store, ada, adaCookie);
  });

  test("a signed-in app refuses another account's magic link and stays signed in", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const adaCookie = await signedInAs(server, store, ada);
    const app = launchApp(server, store);

    const exit = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(bob) })
    );

    expect(failureTag(exit)).toBe("AccountSwitchRefused");
    expect(server.openSessions()).not.toContainEqual(bob);
    expect((await app.client.getSession()).data?.user.id).toBe(ada.id);
    await expectStillSignedIn(server, store, ada, adaCookie);
  });

  test("shows the server's account-switch refusal as one and stays signed in", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const adaCookie = await signedInAs(server, store, ada);
    server.refuseAccountSwitches();
    const app = launchApp(server, store);

    const exit = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(bob) })
    );

    expect(failureTag(exit)).toBe("AccountSwitchRefused");
    expect(server.callsTo("/sign-out")).toEqual([]);
    expect((await app.client.getSession()).data?.user.id).toBe(ada.id);
    await expectStillSignedIn(server, store, ada, adaCookie);
  });

  test("a reauthentication ends with the server's account-switch refusal", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const adaCookie = await signedInAs(server, store, ada);
    server.refuseAccountSwitches();
    // The reauthentication email's link for Bob opens in the mail app while
    // the auth session waits.
    let link: string | undefined;
    const app = launchApp(server, store, async () => {
      link = server.issueMagicLink(bob);
      return AuthSessionResult.Closed();
    });
    const flow = app.runtime.runPromiseExit(reauthenticate);
    while (link === undefined) await Bun.sleep(1);

    const linkExit = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: link })
    );

    expect(failureTag(linkExit)).toBe("AccountSwitchRefused");
    expect(failureTag(await flow)).toBe("AccountSwitchRefused");
    expect(server.callsTo("/sign-out")).toEqual([]);
    await expectStillSignedIn(server, store, ada, adaCookie);
  });

  test("an expired reauthentication still guards its email's links", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    // Ada's reauthentication started two hours ago and its attempt expired;
    // the app is signed out, and the page sent a late email.
    store.values.set(
      pendingSignInKey,
      JSON.stringify({
        verifier: "v".repeat(43),
        state: "s".repeat(43),
        returnUri: nativeReturnUri,
        startedAt: Date.now() - 2 * 60 * 60 * 1000,
        expectedUserId: ada.id,
      })
    );
    const app = launchApp(server, store);

    const exit = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(bob) })
    );
    expect(failureTag(exit)).toBe("AccountSwitchRefused");
    // An expired handoff for that attempt doesn't drop the guard either.
    const expiredHandoff = await app.runtime.runPromiseExit(
      completeAuthCallback({
        kind: "handoff",
        code: "c",
        state: "s".repeat(43),
      })
    );
    expect(failureTag(expiredHandoff)).toBe("SignInLinkRefused");
    const again = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(bob) })
    );
    expect(failureTag(again)).toBe("AccountSwitchRefused");

    // Starting a new sign-in from the app replaces the guard.
    await app.runtime.runPromise(startPendingSignIn(Option.none()));
    const fresh = await app.runtime.runPromise(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(bob) })
    );
    expect(fresh).toEqual(bob);
  });

  test("doesn't spend a magic link when the current session can't be read", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    server.failSessionReads(100);
    const app = launchApp(server, store);
    const exit = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(bob) })
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(server.callsTo("/magic-link/verify")).toEqual([]);
  });

  test("needs a signed-in session", async () => {
    const server = makeFakeAuthServer(origin);
    const app = launchApp(server, makeMemorySecureStore());
    const exit = await app.runtime.runPromiseExit(reauthenticate);
    expect(failureTag(exit)).toBe("NotSignedIn");
    expect(app.opened).toEqual([]);
  });
});
