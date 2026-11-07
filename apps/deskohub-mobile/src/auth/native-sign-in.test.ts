import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer, ManagedRuntime, Option } from "effect";
import { nativeReturnUri, parseAuthCallbackUrl } from "./auth-callback";
import { AuthCallbackCompletions } from "./auth-callback-completions.service";
import { AuthCrypto } from "./auth-crypto.service";
import {
  AuthSessionBrowser,
  AuthSessionResult,
} from "./auth-session-browser.service";
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
import {
  type FakeAuthServer,
  type FakeUser,
  type MemorySecureStore,
  makeFakeAuthServer,
  makeMemorySecureStore,
} from "./testing/fake-auth-server";

const origin = "https://workspace.deskohub.cz";
const ada: FakeUser = { id: "user-ada", email: "ada@example.test" };
const bob: FakeUser = { id: "user-bob", email: "bob@example.test" };

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
  const client = createNativeAuthClient({
    origin,
    storage: store,
    fetch: server.fetch,
  });
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
      NativeAuth.fromClient(origin, client),
      PendingSignIns.fromStore(store),
      AuthCrypto.Live,
      AuthCallbackCompletions.Default,
      browser
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

describe("native session store", () => {
  test("a verified magic link stores the session cookie", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    const app = launchApp(server, store);

    const user = await app.runtime.runPromise(
      completeAuthCallback({
        kind: "token",
        token: server.issueMagicLink(ada),
      })
    );

    expect(user).toEqual(ada);
    expect(storedCookie(store)).toContain("better-auth.session_token");
    // Amendment A: the app verifies with the token alone.
    expect(
      server.callsTo("/magic-link/verify").map((call) => call.query)
    ).toEqual([["token"]]);
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

    const user = await app.runtime.runPromise(signInWithEmail(Option.none()));

    expect(user).toEqual(ada);
    expect(server.callsTo("/native-handoff/exchange")).toHaveLength(1);
    expect(store.values.has(pendingSignInKey)).toBe(false);
    expect(storedCookie(store)).toContain("session_token");
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
  };

  test("asks the page to sign in again and keeps the same account", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    await signedInAs(server, store, ada);
    const app = launchApp(server, store, webSignInAs(server, ada));

    const user = await app.runtime.runPromise(reauthenticate);

    expect(user).toEqual(ada);
    expect(new URL(app.opened[0] ?? "").searchParams.get("prompt")).toBe(
      "login"
    );
  });

  test("refuses to switch to another account and signs that session out", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    await signedInAs(server, store, ada);
    const app = launchApp(server, store, webSignInAs(server, bob));

    const exit = await app.runtime.runPromiseExit(reauthenticate);

    expect(failureTag(exit)).toBe("AccountSwitchRefused");
    expect(server.openSessions()).not.toContainEqual(bob);
    expect(storedCookie(store)).not.toContain("session_token");
  });

  test("signs the new session out when its account can't be confirmed", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    await signedInAs(server, store, ada);
    server.failSessionReadsAfterExchange(100);
    const app = launchApp(server, store, webSignInAs(server, bob));

    const exit = await app.runtime.runPromiseExit(reauthenticate);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(server.openSessions()).not.toContainEqual(bob);
    expect(storedCookie(store)).not.toContain("session_token");
  });

  test("keeps refusing the other account's links after a refusal", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    await signedInAs(server, store, ada);
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
  });

  test("a signed-in app refuses another account's magic link", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    await signedInAs(server, store, ada);
    const app = launchApp(server, store);

    const exit = await app.runtime.runPromiseExit(
      completeAuthCallback({ kind: "token", token: server.issueMagicLink(bob) })
    );

    expect(failureTag(exit)).toBe("AccountSwitchRefused");
    expect(server.openSessions()).not.toContainEqual(bob);
  });

  test("an expired reauthentication still guards its email's links", async () => {
    const server = makeFakeAuthServer(origin);
    const store = makeMemorySecureStore();
    // Ada's reauthentication started two hours ago and its attempt expired;
    // the app is signed out after an earlier refusal, and the page sent a
    // late email.
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
