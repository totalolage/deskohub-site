import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { PasskeyCeremonies } from "./passkey-ceremony";
import type { PasskeyFailure } from "./passkey-failure";
import {
  PasskeyPluginClient,
  type PasskeyPluginResult,
} from "./passkey-plugin-client.service";

const signedIn: PasskeyPluginResult = {
  data: { session: { id: "synthetic-session" }, user: { id: "synthetic" } },
  error: null,
};

const created: PasskeyPluginResult = {
  data: {
    id: "synthetic-passkey",
    name: null,
    createdAt: "2026-11-07T08:00:00.000Z",
  },
  error: null,
};

const failed = (code: string, status = 400): PasskeyPluginResult => ({
  data: null,
  error: { code, status },
});

const setup = ({
  supported = true,
  signIn = async () => signedIn,
  addPasskey = async () => created,
}: {
  readonly supported?: boolean;
  readonly signIn?: () => Promise<PasskeyPluginResult>;
  readonly addPasskey?: (input: {
    readonly name?: string;
  }) => Promise<PasskeyPluginResult>;
} = {}) =>
  Effect.runSync(
    Effect.service(PasskeyCeremonies).pipe(
      Effect.provide(
        PasskeyCeremonies.Web.pipe(
          Layer.provide(
            PasskeyPluginClient.fromClient(
              { signIn: { passkey: signIn }, passkey: { addPasskey } },
              () => supported
            )
          )
        )
      )
    )
  );

const failureOf = async <A>(
  effect: Effect.Effect<A, PasskeyFailure>
): Promise<PasskeyFailure> => Effect.runPromise(Effect.flip(effect));

describe("web passkey ceremonies", () => {
  test("sign in through the plugin", async () => {
    let calls = 0;
    const ceremonies = setup({
      signIn: async () => {
        calls += 1;
        return signedIn;
      },
    });

    await Effect.runPromise(ceremonies.signIn);

    expect(calls).toBe(1);
  });

  test("add a passkey with its name and return it", async () => {
    let requested: unknown;
    const ceremonies = setup({
      addPasskey: async (input) => {
        requested = input;
        return created;
      },
    });

    expect(
      await Effect.runPromise(ceremonies.addPasskey({ name: "Laptop" }))
    ).toEqual({ id: "synthetic-passkey", name: undefined });
    expect(requested).toEqual({ name: "Laptop" });
  });

  test.each([
    ["AUTH_CANCELLED", "PasskeyCancelled"],
    ["ERROR_CEREMONY_ABORTED", "PasskeyCancelled"],
    ["ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", "PasskeyCancelled"],
    ["ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", "PasskeyAlreadyRegistered"],
    ["ERROR_INVALID_DOMAIN", "PasskeyCeremonyFailed"],
    ["UNKNOWN_ERROR", "PasskeyCeremonyFailed"],
  ])("maps the browser outcome %s to %s", async (code, tag) => {
    const ceremonies = setup({
      signIn: async () => failed(code),
      addPasskey: async () => failed(code),
    });

    expect<string>((await failureOf(ceremonies.signIn))._tag).toBe(tag);
    expect<string>((await failureOf(ceremonies.addPasskey()))._tag).toBe(tag);
  });

  test("reports the server's refusal with its Better Auth code", async () => {
    const ceremonies = setup({
      signIn: async () => failed("PASSKEY_USER_VERIFICATION_REQUIRED", 403),
      addPasskey: async () => failed("SESSION_NOT_FRESH", 403),
    });

    expect(await failureOf(ceremonies.signIn)).toMatchObject({
      _tag: "PasskeyRejected",
      status: 403,
      code: "PASSKEY_USER_VERIFICATION_REQUIRED",
    });
    expect(await failureOf(ceremonies.addPasskey())).toMatchObject({
      _tag: "PasskeyRejected",
      code: "SESSION_NOT_FRESH",
      needsReauthentication: true,
    });
  });

  test("fails without calling the plugin in a browser without passkeys", async () => {
    let calls = 0;
    const ceremonies = setup({
      supported: false,
      signIn: async () => {
        calls += 1;
        return signedIn;
      },
    });

    expect((await failureOf(ceremonies.signIn))._tag).toBe(
      "PasskeyNotSupported"
    );
    expect(calls).toBe(0);
  });

  test("reports a plugin call that rejected or resolved an unexpected shape", async () => {
    const ceremonies = setup({
      signIn: async () => {
        throw new TypeError("Failed to fetch");
      },
      addPasskey: async () => ({ data: { id: 7 }, error: null }),
    });

    expect(await failureOf(ceremonies.signIn)).toMatchObject({
      _tag: "PasskeyCeremonyFailed",
      step: "request",
    });
    expect(await failureOf(ceremonies.addPasskey())).toMatchObject({
      _tag: "PasskeyCeremonyFailed",
      step: "response",
    });
  });

  test("refuses a second ceremony until the plugin call settles, even after an interruption", async () => {
    const release = Deferred.makeUnsafe<void>();
    let calls = 0;
    const ceremonies = setup({
      signIn: async () => {
        calls += 1;
        await Effect.runPromise(Deferred.await(release));
        return signedIn;
      },
    });

    const first = Effect.runFork(ceremonies.signIn);
    while (calls === 0) await Effect.runPromise(Effect.yieldNow);
    const interrupted = Effect.runFork(Fiber.interrupt(first));

    expect((await failureOf(ceremonies.addPasskey()))._tag).toBe(
      "PasskeyCeremonyBusy"
    );

    Deferred.doneUnsafe(release, Exit.void);
    await Effect.runPromise(Fiber.join(interrupted));
    await Effect.runPromise(ceremonies.signIn);
    expect(calls).toBe(2);
  });
});
