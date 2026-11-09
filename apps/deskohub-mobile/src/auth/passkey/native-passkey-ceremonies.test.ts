import { describe, expect, test } from "bun:test";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Semaphore,
} from "effect";
import { SessionWriteLock } from "../session-write-lock";
import {
  NativePasskeyModule,
  type NativePasskeyModuleSource,
} from "./native-passkey-module.service";
import fixtures from "./passkey.test-fixtures.json";
import {
  PasskeyAuthClient,
  type PasskeyAuthClientSource,
} from "./passkey-auth-client.service";
import { PasskeyCeremonies } from "./passkey-ceremony";
import type { PasskeyFailure } from "./passkey-failure";

const {
  registrationOptions,
  registrationResponse,
  authenticationOptions,
  authenticationResponse,
} = fixtures;

type AuthFetch = PasskeyAuthClientSource["$fetch"];
type AuthFetchOptions = Parameters<AuthFetch>[1];
type NativePasskeyAuthenticator = NativePasskeyModuleSource;

/** The native ceremonies on fake auth client and native module Layers. */
const makeNativePasskeyCeremonies = ({
  fetch,
  authenticator,
  refreshSession,
}: {
  readonly fetch: AuthFetch;
  readonly authenticator: NativePasskeyAuthenticator;
  readonly refreshSession: () => void;
}) =>
  Effect.runSync(
    Effect.service(PasskeyCeremonies).pipe(
      Effect.provide(
        PasskeyCeremonies.Native.pipe(
          Layer.provide(
            Layer.mergeAll(
              PasskeyAuthClient.fromClient({
                $fetch: fetch,
                $store: { notify: refreshSession },
              }),
              NativePasskeyModule.fromModule(authenticator)
            )
          )
        )
      )
    )
  );

type Reply = { readonly status: number; readonly body: unknown };

const ok = (body: unknown): Reply => ({ status: 200, body });
const refused = (status: number, code: string): Reply => ({
  status,
  body: { code, message: "Refused." },
});

/**
 * A stand-in for the Expo client's `$fetch`: one cookie jar that the options
 * responses fill with a challenge cookie and every request sends back, as the
 * SecureStore jar does.
 */
const makeServer = (replies: Readonly<Record<string, Reply>>) => {
  const jar = new Map<string, string>();
  const calls: {
    readonly path: string;
    readonly options: AuthFetchOptions;
    readonly cookie: string | undefined;
  }[] = [];
  let challenges = 0;
  const fetch: AuthFetch = async (path, options) => {
    calls.push({ path, options, cookie: jar.get("better-auth-passkey") });
    options.signal.throwIfAborted();
    const reply = replies[path];
    if (!reply) throw new TypeError("Network request failed");
    if (reply.status === 200 && path.includes("/generate-")) {
      challenges += 1;
      jar.set("better-auth-passkey", `challenge-${challenges}`);
    }
    return reply.status === 200
      ? { data: reply.body, error: null }
      : {
          data: null,
          error: { status: reply.status, ...(reply.body as object) },
        };
  };
  return { fetch, calls };
};

const signInReplies = {
  "/passkey/generate-authenticate-options": ok(authenticationOptions),
  "/passkey/verify-authentication": ok({
    session: { id: "synthetic-session" },
    user: { id: "synthetic-user" },
  }),
};

const registrationReplies = {
  "/passkey/generate-register-options": ok(registrationOptions),
  "/passkey/verify-registration": ok({
    id: "synthetic-passkey",
    name: "Pixel",
    createdAt: "2026-11-07T08:00:00.000Z",
  }),
};

const authenticator = (
  overrides: Partial<NativePasskeyAuthenticator> = {}
): NativePasskeyAuthenticator => ({
  isSupported: () => true,
  get: async () => authenticationResponse,
  create: async () => registrationResponse,
  ...overrides,
});

const setup = (
  replies: Readonly<Record<string, Reply>>,
  overrides: Partial<NativePasskeyAuthenticator> = {}
) => {
  const server = makeServer(replies);
  let sessionRefreshes = 0;
  const ceremonies = makeNativePasskeyCeremonies({
    fetch: server.fetch,
    authenticator: authenticator(overrides),
    refreshSession: () => {
      sessionRefreshes += 1;
    },
  });
  return {
    ceremonies,
    calls: server.calls,
    sessionRefreshes: () => sessionRefreshes,
  };
};

const failureOf = async <A>(
  effect: Effect.Effect<A, PasskeyFailure>
): Promise<PasskeyFailure> => Effect.runPromise(Effect.flip(effect));

describe("passkey ceremonies and sign-out", () => {
  test("a sign-in sends nothing until a sign-out in flight has settled", async () => {
    const { ceremonies, calls } = setup(signInReplies);
    const lock = Semaphore.makeUnsafe(1);
    const sentWhileSigningOut = await Effect.runPromise(
      Effect.gen(function* () {
        // A sign-out in flight holds the session.
        yield* lock.take(1);
        const signingIn = yield* Effect.forkChild(ceremonies.signIn);
        yield* Effect.promise(() => Bun.sleep(5));
        const sent = calls.length;
        yield* lock.release(1);
        yield* Fiber.join(signingIn);
        return sent;
      }).pipe(Effect.provideService(SessionWriteLock, lock))
    );
    expect(sentWhileSigningOut).toBe(0);
    expect(calls.map(({ path }) => path)).toEqual([
      "/passkey/generate-authenticate-options",
      "/passkey/verify-authentication",
    ]);
  });

  test("a sign-out waits for a running ceremony", async () => {
    let answerPrompt: () => void = () => undefined;
    const prompt = new Promise<void>((resolve) => {
      answerPrompt = resolve;
    });
    const { ceremonies, calls } = setup(signInReplies, {
      get: async () => {
        await prompt;
        return authenticationResponse;
      },
    });
    const lock = Semaphore.makeUnsafe(1);
    const [duringCeremony, afterCeremony] = await Effect.runPromise(
      Effect.gen(function* () {
        const signingIn = yield* Effect.forkChild(ceremonies.signIn);
        while (calls.length === 0) yield* Effect.promise(() => Bun.sleep(1));
        const during = yield* lock.withPermitsIfAvailable(1)(Effect.void);
        answerPrompt();
        yield* Fiber.join(signingIn);
        const after = yield* lock.withPermitsIfAvailable(1)(Effect.void);
        return [during, after] as const;
      }).pipe(Effect.provideService(SessionWriteLock, lock))
    );
    expect(Option.isNone(duringCeremony)).toBe(true);
    expect(Option.isSome(afterCeremony)).toBe(true);
  });
});

describe("passkey sign-in", () => {
  test("asks for options, the passkey, then verification, and refreshes the session", async () => {
    let requested: unknown;
    const { ceremonies, calls, sessionRefreshes } = setup(signInReplies, {
      get: async (options) => {
        requested = options;
        return authenticationResponse;
      },
    });

    await Effect.runPromise(ceremonies.signIn);

    expect(calls.map(({ path, options }) => [options.method, path])).toEqual([
      ["GET", "/passkey/generate-authenticate-options"],
      ["POST", "/passkey/verify-authentication"],
    ]);
    expect(requested).toEqual(authenticationOptions);
    expect(calls[1]?.options.body).toEqual({
      response: authenticationResponse,
    });
    expect(sessionRefreshes()).toBe(1);
  });

  test("sends the verification with the challenge cookie its options set", async () => {
    const { ceremonies, calls } = setup(signInReplies);

    await Effect.runPromise(ceremonies.signIn);
    await Effect.runPromise(ceremonies.signIn);

    expect(calls.map(({ cookie }) => cookie)).toEqual([
      undefined,
      "challenge-1",
      "challenge-1",
      "challenge-2",
    ]);
  });

  test("posts the module's result in SimpleWebAuthn's encoding", async () => {
    const { response } = authenticationResponse;
    const standard = (value: string) =>
      Buffer.from(value, "base64url").toString("base64");
    const { ceremonies, calls } = setup(signInReplies, {
      get: async () => ({
        ...authenticationResponse,
        rawId: null,
        clientExtensionResults: null,
        response: {
          ...response,
          signature: standard(response.signature),
          userHandle: standard(response.userHandle),
        },
      }),
    });

    await Effect.runPromise(ceremonies.signIn);

    expect(calls[1]?.options.body).toEqual({
      response: authenticationResponse,
    });
  });

  test("refuses a second ceremony while one is running", async () => {
    const release = Deferred.makeUnsafe<void>();
    const { ceremonies, calls } = setup(
      { ...signInReplies, ...registrationReplies },
      {
        get: async () => {
          await Effect.runPromise(Deferred.await(release));
          return authenticationResponse;
        },
      }
    );

    const first = Effect.runFork(ceremonies.signIn);
    while (calls.length === 0) await Effect.runPromise(Effect.yieldNow);

    expect((await failureOf(ceremonies.signIn))._tag).toBe(
      "PasskeyCeremonyBusy"
    );
    expect((await failureOf(ceremonies.addPasskey()))._tag).toBe(
      "PasskeyCeremonyBusy"
    );
    expect(calls).toHaveLength(1);

    Deferred.doneUnsafe(release, Exit.void);
    await Effect.runPromise(Fiber.join(first));
    await Effect.runPromise(ceremonies.signIn);
    expect(calls).toHaveLength(4);
  });

  test("ends as cancelled when the customer closes the prompt", async () => {
    const { ceremonies, calls, sessionRefreshes } = setup(signInReplies, {
      get: async () => {
        throw Object.assign(new Error("UserCancelled"), {
          code: "Passkey Get",
        });
      },
    });

    expect((await failureOf(ceremonies.signIn))._tag).toBe("PasskeyCancelled");
    expect(calls).toHaveLength(1);
    expect(sessionRefreshes()).toBe(0);
  });

  test("reports the server's refusal with its Better Auth code", async () => {
    const { ceremonies, sessionRefreshes } = setup({
      ...signInReplies,
      "/passkey/verify-authentication": refused(
        403,
        "PASSKEY_ACCOUNT_MISMATCH"
      ),
    });

    const failure = await failureOf(ceremonies.signIn);

    expect(failure).toMatchObject({
      _tag: "PasskeyRejected",
      status: 403,
      code: "PASSKEY_ACCOUNT_MISMATCH",
    });
    expect(sessionRefreshes()).toBe(0);
  });

  test("fails without a request on a device without passkeys", async () => {
    const { ceremonies, calls } = setup(signInReplies, {
      isSupported: () => false,
    });

    expect((await failureOf(ceremonies.signIn))._tag).toBe(
      "PasskeyNotSupported"
    );
    expect(calls).toHaveLength(0);
  });

  test("reports a request that never reached the server", async () => {
    const { ceremonies } = setup({});

    expect(await failureOf(ceremonies.signIn)).toMatchObject({
      _tag: "PasskeyCeremonyFailed",
      step: "request",
    });
  });

  test("reports options or a result of an unexpected shape", async () => {
    const malformedOptions = setup({
      ...signInReplies,
      "/passkey/generate-authenticate-options": ok({ challenge: 7 }),
    });
    const emptyResult = setup(signInReplies, { get: async () => null });

    expect(await failureOf(malformedOptions.ceremonies.signIn)).toMatchObject({
      _tag: "PasskeyCeremonyFailed",
      step: "response",
    });
    expect(await failureOf(emptyResult.ceremonies.signIn)).toMatchObject({
      _tag: "PasskeyCeremonyFailed",
      step: "authenticator",
    });
    expect(emptyResult.calls).toHaveLength(1);
  });

  test("aborts an interrupted request and waits for its cookie write before the next ceremony", async () => {
    const cookieWritten = Deferred.makeUnsafe<void>();
    const signals: AbortSignal[] = [];
    const verifiedWith: (string | undefined)[] = [];
    let challenge: string | undefined;
    let optionRequests = 0;
    const ceremonies = makeNativePasskeyCeremonies({
      fetch: async (path, { signal }) => {
        signals.push(signal);
        if (path === "/passkey/verify-authentication") {
          verifiedWith.push(challenge);
          return { data: {}, error: null };
        }
        optionRequests += 1;
        const issued = `challenge-${optionRequests}`;
        // The first response already arrived: the Expo client finishes
        // writing its cookie to SecureStore even after the abort.
        if (optionRequests === 1) {
          await Effect.runPromise(Deferred.await(cookieWritten));
        }
        challenge = issued;
        return { data: authenticationOptions, error: null };
      },
      authenticator: authenticator(),
      refreshSession: () => {},
    });

    const first = Effect.runFork(ceremonies.signIn);
    while (signals.length === 0) await Effect.runPromise(Effect.yieldNow);
    const interrupted = Effect.runFork(Fiber.interrupt(first));
    while (!signals[0]?.aborted) await Effect.runPromise(Effect.yieldNow);

    expect((await failureOf(ceremonies.signIn))._tag).toBe(
      "PasskeyCeremonyBusy"
    );

    Deferred.doneUnsafe(cookieWritten, Exit.void);
    await Effect.runPromise(Fiber.join(interrupted));
    await Effect.runPromise(ceremonies.signIn);

    expect(verifiedWith).toEqual(["challenge-2"]);
    expect(signals).toHaveLength(3);
  });
});

describe("adding a passkey", () => {
  test("asks for options, creates the passkey, then verifies it with its name", async () => {
    let requested: unknown;
    const { ceremonies, calls, sessionRefreshes } = setup(registrationReplies, {
      create: async (options) => {
        requested = options;
        return registrationResponse;
      },
    });

    const added = await Effect.runPromise(
      ceremonies.addPasskey({ name: "Work phone" })
    );

    expect(added).toEqual({ id: "synthetic-passkey", name: "Pixel" });
    expect(calls.map(({ path, options }) => [options.method, path])).toEqual([
      ["GET", "/passkey/generate-register-options"],
      ["POST", "/passkey/verify-registration"],
    ]);
    const { extensions: _, hints: __, ...taken } = registrationOptions;
    expect(requested).toEqual(taken);
    expect(calls[1]?.cookie).toBe("challenge-1");
    expect(calls[1]?.options.body).toEqual({
      name: "Work phone",
      response: registrationResponse,
    });
    expect(sessionRefreshes()).toBe(0);
  });

  test("surfaces a stale session as needing reauthentication", async () => {
    let created = false;
    const { ceremonies } = setup(
      {
        ...registrationReplies,
        "/passkey/generate-register-options": refused(403, "SESSION_NOT_FRESH"),
      },
      {
        create: async () => {
          created = true;
          return registrationResponse;
        },
      }
    );

    const failure = await failureOf(ceremonies.addPasskey());

    expect(failure).toMatchObject({
      _tag: "PasskeyRejected",
      code: "SESSION_NOT_FRESH",
      needsReauthentication: true,
    });
    expect(created).toBe(false);
  });

  test("reports a passkey the authenticator already holds", async () => {
    const { ceremonies, calls } = setup(registrationReplies, {
      create: async () => {
        throw Object.assign(
          new Error("DomError: InvalidStateError - already registered"),
          { code: "Passkey Create" }
        );
      },
    });

    expect((await failureOf(ceremonies.addPasskey()))._tag).toBe(
      "PasskeyAlreadyRegistered"
    );
    expect(calls).toHaveLength(1);
  });
});
