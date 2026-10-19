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
import { unsafeReturnTargets } from "@/shared/testing/unsafe-return-targets.test-utils";

type PasskeyResponse = {
  readonly data?: unknown;
  readonly error: { readonly code?: string; readonly status?: number } | null;
};

const failure = (code: string): PasskeyResponse => ({
  data: null,
  error: { code, status: 400 },
});

const signInPasskey = mock(
  (): Promise<PasskeyResponse> => Promise.resolve({ data: null, error: null })
);
const requestPasskeySignIn = mock(
  (_request: {
    readonly autoFill: boolean;
    readonly signal?: AbortSignal;
  }): Promise<PasskeyResponse> => Promise.resolve({ data: null, error: null })
);
const addPasskey = mock(
  (): Promise<PasskeyResponse> => Promise.resolve({ data: null, error: null })
);
const updatePasskey = mock(
  (_body: { readonly id: string; readonly name: string }) =>
    Promise.resolve<PasskeyResponse>({ data: null, error: null })
);
const deletePasskey = mock((_body: { readonly id: string }) =>
  Promise.resolve<PasskeyResponse>({ data: null, error: null })
);
const recordSignInCompletion = mock((_method: string) => undefined);
const rememberPasskeyOnThisBrowser = mock((_accountId: string) => undefined);
const forgetEmailSignInRequest = mock(() => undefined);

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: { passkey: signInPasskey },
    passkey: { addPasskey, updatePasskey, deletePasskey },
  },
}));
mock.module("./passkey-sign-in", () => ({ requestPasskeySignIn }));
mock.module("./sign-in-analytics", () => ({ recordSignInCompletion }));
mock.module("./passkey-prompt", () => ({ rememberPasskeyOnThisBrowser }));
mock.module("./email-sign-in-request", () => ({ forgetEmailSignInRequest }));

let passkeyClient: typeof import("./passkey-client");
let originalReplace: typeof window.location.replace;
const replace = mock((_url: string | URL) => undefined);

describe("passkey client", () => {
  beforeAll(async () => {
    GlobalRegistrator.register();
    originalReplace = window.location.replace;
    passkeyClient = await import("./passkey-client");
  });

  beforeEach(() => {
    window.location.replace = replace;
    for (const fn of [
      signInPasskey,
      requestPasskeySignIn,
      addPasskey,
      updatePasskey,
      deletePasskey,
      recordSignInCompletion,
      rememberPasskeyOnThisBrowser,
      forgetEmailSignInRequest,
      replace,
    ]) {
      fn.mockClear();
    }
  });

  afterEach(() => {
    window.location.replace = originalReplace;
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test.each([
    [{ error: null }, "signed-in"],
    [{ error: { code: "ERROR_CEREMONY_ABORTED" } }, "cancelled"],
    [{ error: { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" } }, "cancelled"],
    [{ error: { code: "AUTH_CANCELLED" } }, "cancelled"],
    [{ error: { code: "PASSKEY_NOT_FOUND" } }, "failed"],
    [{ error: {} }, "failed"],
  ] as const)("maps a sign-in response %j to %s", (response, result) => {
    expect(passkeyClient.toPasskeySignInResult(response)).toBe(result);
  });

  test.each([
    [{ error: null }, "created"],
    [{ error: { code: "SESSION_NOT_FRESH" } }, "reauthentication-required"],
    [{ error: { code: "ERROR_CEREMONY_ABORTED" } }, "cancelled"],
    [{ error: { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" } }, "cancelled"],
    [{ error: { code: "PASSKEY_REGISTRATION_UNAVAILABLE" } }, "failed"],
    [
      { error: { code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" } },
      "failed",
    ],
  ] as const)("maps a creation response %j to %s", (response, result) => {
    expect(passkeyClient.toPasskeyCreationResult(response)).toBe(result);
  });

  test.each([
    [{ error: null }, "confirmed"],
    [{ error: { code: "PASSKEY_ACCOUNT_MISMATCH" } }, "wrong-account"],
    [{ error: { code: "PASSKEY_USER_VERIFICATION_REQUIRED" } }, "failed"],
    [{ error: { code: "AUTH_CANCELLED" } }, "cancelled"],
    [{ error: { code: "AUTHENTICATION_FAILED" } }, "failed"],
  ] as const)("maps a confirmation response %j to %s", (response, result) => {
    expect(passkeyClient.toPasskeyConfirmationResult(response)).toBe(result);
  });

  test("signs in, remembers the passkey for the account, and opens the account", async () => {
    requestPasskeySignIn.mockResolvedValueOnce({
      data: { session: { userId: "account-1" }, user: { id: "account-1" } },
      error: null,
    });

    await expect(
      passkeyClient.signInWithPasskey({ locale: "cs-CZ" })
    ).resolves.toBe("signed-in");

    expect(requestPasskeySignIn).toHaveBeenCalledWith({
      autoFill: false,
      signal: undefined,
    });
    expect(rememberPasskeyOnThisBrowser).toHaveBeenCalledWith("account-1");
    expect(recordSignInCompletion).toHaveBeenCalledWith("passkey");
    expect(forgetEmailSignInRequest).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/cs-CZ/account");
  });

  test("continues to a same-origin return target after a passkey sign-in", async () => {
    const signedIn = {
      data: { session: { userId: "account-1" }, user: { id: "account-1" } },
      error: null,
    };
    requestPasskeySignIn.mockResolvedValueOnce(signedIn);

    await expect(
      passkeyClient.signInWithPasskey({
        locale: "cs-CZ",
        returnTo: "/cs-CZ/admin/invoices?page=2",
      })
    ).resolves.toBe("signed-in");

    expect(replace.mock.calls).toEqual([["/cs-CZ/admin/invoices?page=2"]]);
  });

  test.each(unsafeReturnTargets)(
    "ignores %p and opens the account after a passkey sign-in",
    async (unsafeReturnTo) => {
      requestPasskeySignIn.mockResolvedValueOnce({
        data: { session: { userId: "account-1" }, user: { id: "account-1" } },
        error: null,
      });

      await passkeyClient.signInWithPasskey({
        locale: "cs-CZ",
        returnTo: unsafeReturnTo,
      });

      expect(replace.mock.calls).toEqual([["/cs-CZ/account"]]);
    }
  );

  test.each([
    ["while the sign-in resolves", (owner: AbortController) => owner.abort()],
    [
      "right after the sign-in resolves",
      (owner: AbortController) => queueMicrotask(() => owner.abort()),
    ],
  ])(
    "keeps the session but leaves the page alone when the attempt is cancelled %s",
    async (_timing, cancel) => {
      const owner = new AbortController();
      requestPasskeySignIn.mockImplementationOnce(() => {
        cancel(owner);
        return Promise.resolve({
          data: { session: { userId: "account-1" }, user: { id: "account-1" } },
          error: null,
        });
      });

      await expect(
        passkeyClient.signInWithPasskey({
          locale: "cs-CZ",
          returnTo: "/cs-CZ/admin/invoices?page=2",
          signal: owner.signal,
        })
      ).resolves.toBe("cancelled");

      expect(rememberPasskeyOnThisBrowser).toHaveBeenCalledWith("account-1");
      expect(recordSignInCompletion).toHaveBeenCalledWith("passkey");
      expect(forgetEmailSignInRequest).toHaveBeenCalledTimes(1);
      expect(replace).not.toHaveBeenCalled();
    }
  );

  test("passes autofill through and stays on the page when it is cancelled", async () => {
    requestPasskeySignIn.mockResolvedValueOnce(failure("AUTH_CANCELLED"));

    const card = new AbortController();
    await expect(
      passkeyClient.signInWithPasskey({
        locale: "en-US",
        autoFill: true,
        signal: card.signal,
      })
    ).resolves.toBe("cancelled");

    expect(requestPasskeySignIn).toHaveBeenCalledWith({
      autoFill: true,
      signal: card.signal,
    });
    expect(recordSignInCompletion).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  test("confirms with the plugin client's own ceremony, outside the sign-in attempts", async () => {
    await expect(passkeyClient.confirmWithPasskey()).resolves.toBe("confirmed");

    expect(signInPasskey).toHaveBeenCalledTimes(1);
    expect(requestPasskeySignIn).not.toHaveBeenCalled();
  });

  test("reads a throwing or malformed client response as a failure", async () => {
    requestPasskeySignIn.mockRejectedValueOnce(new Error("synthetic network"));
    await expect(
      passkeyClient.signInWithPasskey({ locale: "en-US" })
    ).resolves.toBe("failed");

    addPasskey.mockResolvedValueOnce("unexpected" as never);
    await expect(passkeyClient.createPasskey("account-1")).resolves.toEqual({
      result: "failed",
    });
    expect(replace).not.toHaveBeenCalled();
  });

  test("returns the created passkey and remembers it on this browser", async () => {
    addPasskey.mockResolvedValueOnce({
      data: {
        id: "passkey-1",
        name: "Google Password Manager",
        createdAt: "2026-10-16T09:00:00.000Z",
        publicKey: "synthetic",
      },
      error: null,
    });

    await expect(passkeyClient.createPasskey("account-1")).resolves.toEqual({
      result: "created",
      passkey: {
        id: "passkey-1",
        name: "Google Password Manager",
        provider: undefined,
        createdAt: "2026-10-16T09:00:00.000Z",
      },
    });
    expect(rememberPasskeyOnThisBrowser).toHaveBeenCalledWith("account-1");
  });

  test("asks for re-authentication without remembering a passkey", async () => {
    addPasskey.mockResolvedValueOnce({
      data: null,
      error: { code: "SESSION_NOT_FRESH", status: 403 },
    });

    await expect(passkeyClient.createPasskey("account-1")).resolves.toEqual({
      result: "reauthentication-required",
    });
    expect(rememberPasskeyOnThisBrowser).not.toHaveBeenCalled();
  });

  test("remembers an authenticator that already holds a passkey for the account", async () => {
    addPasskey.mockResolvedValueOnce(
      failure("ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
    );

    await expect(passkeyClient.createPasskey("account-1")).resolves.toEqual({
      result: "failed",
    });
    expect(rememberPasskeyOnThisBrowser).toHaveBeenCalledWith("account-1");
  });

  test("renames and deletes through the plugin client", async () => {
    await expect(
      passkeyClient.renamePasskey("passkey-1", "Work laptop")
    ).resolves.toBe("saved");
    expect(updatePasskey).toHaveBeenCalledWith({
      id: "passkey-1",
      name: "Work laptop",
    });

    deletePasskey.mockResolvedValueOnce(failure("PASSKEY_NOT_FOUND"));
    await expect(passkeyClient.deletePasskey("passkey-1")).resolves.toBe(
      "failed"
    );
    expect(deletePasskey).toHaveBeenCalledWith({ id: "passkey-1" });
  });
});
