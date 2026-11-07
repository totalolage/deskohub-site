import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Option } from "effect";

type SessionRead = () => Promise<{
  readonly data: { readonly user: { readonly id: string } } | null;
  readonly error: { readonly status?: number; readonly code?: string } | null;
}>;

let readSession: SessionRead = async () => ({ data: null, error: null });
let signOuts = 0;
/** The account a verified magic link signs the browser in to. */
let linkAccount = "bob";

mock.module("./auth-client.web", () => ({
  authClient: {
    getSession: () => readSession(),
    magicLink: {
      verify: async () => {
        readSession = async () => ({
          data: { user: { id: linkAccount } },
          error: null,
        });
        return { data: { status: true }, error: null };
      },
    },
    signOut: async () => {
      signOuts += 1;
      return { data: { success: true }, error: null };
    },
  },
}));

const {
  completeWebMagicLink,
  confirmWebAccount,
  prepareReauthenticationEmail,
  reauthenticationExpectation,
} = await import("./web-sign-in");
const { clearReauthenticatingUser, loadReauthenticatingUser } = await import(
  "./web-reauthentication-store"
);

/** A browser `localStorage`, or one that refuses access. */
const useStorage = (available: boolean) => {
  const stored = new Map<string, string>();
  const refuse = () => {
    throw new DOMException("denied", "SecurityError");
  };
  Object.assign(globalThis, {
    localStorage: available
      ? {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => void stored.set(key, value),
          removeItem: (key: string) => void stored.delete(key),
        }
      : { getItem: refuse, setItem: refuse, removeItem: refuse },
  });
};

const reasonOf = async (
  expectation: Parameters<typeof confirmWebAccount>[0]
): Promise<string | undefined> => {
  const exit = await Effect.runPromiseExit(confirmWebAccount(expectation));
  return Exit.isSuccess(exit)
    ? undefined
    : Option.getOrUndefined(Exit.findErrorOption(exit))?.reason;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

beforeEach(() => {
  signOuts = 0;
  linkAccount = "bob";
  readSession = async () => ({ data: { user: { id: "ada" } }, error: null });
});

describe("confirmWebAccount", () => {
  test("an ordinary sign-in isn't checked", async () => {
    readSession = async () => {
      throw new Error("not called");
    };
    expect(await reasonOf({ kind: "none" })).toBeUndefined();
    expect(signOuts).toBe(0);
  });

  test("accepts the account the reauthentication started from", async () => {
    expect(await reasonOf({ kind: "account", userId: "ada" })).toBeUndefined();
    expect(signOuts).toBe(0);
  });

  test("signs out and refuses another account", async () => {
    expect(await reasonOf({ kind: "account", userId: "bob" })).toBe(
      "account-switch"
    );
    expect(signOuts).toBe(1);
  });

  test("signs out and refuses when the session can't be read", async () => {
    readSession = async () => {
      throw new TypeError("Network request failed");
    };
    expect(await reasonOf({ kind: "account", userId: "ada" })).toBe(
      "reauthentication-unconfirmed"
    );
    readSession = async () => ({ data: null, error: { status: 500 } });
    expect(await reasonOf({ kind: "account", userId: "ada" })).toBe(
      "reauthentication-unconfirmed"
    );
    readSession = async () => ({ data: null, error: null });
    expect(await reasonOf({ kind: "account", userId: "ada" })).toBe(
      "reauthentication-unconfirmed"
    );
    expect(signOuts).toBe(3);
  });

  test("signs out and refuses when the expected account is unknown", async () => {
    expect(await reasonOf({ kind: "unrecoverable" })).toBe(
      "reauthentication-unconfirmed"
    );
    expect(signOuts).toBe(1);
  });
});

describe("reauthenticationExpectation", () => {
  test("expects nothing of an ordinary sign-in", () => {
    expect(
      reauthenticationExpectation({
        reauthenticating: false,
        sessionUserId: "ada",
        storedUserId: Option.some("ada"),
      })
    ).toEqual({ kind: "none" });
  });

  test("prefers the page's own session, then storage", () => {
    expect(
      reauthenticationExpectation({
        reauthenticating: true,
        sessionUserId: "ada",
        storedUserId: Option.some("bob"),
      })
    ).toEqual({ kind: "account", userId: "ada" });
    expect(
      reauthenticationExpectation({
        reauthenticating: true,
        sessionUserId: undefined,
        storedUserId: Option.some("bob"),
      })
    ).toEqual({ kind: "account", userId: "bob" });
  });

  test("fails closed when storage lost or expired the account", () => {
    expect(
      reauthenticationExpectation({
        reauthenticating: true,
        sessionUserId: undefined,
        storedUserId: Option.none(),
      })
    ).toEqual({ kind: "unrecoverable" });
  });
});

describe("completeWebMagicLink", () => {
  const linkReason = async (
    context: Parameters<typeof completeWebMagicLink>[1]
  ): Promise<string | undefined> => {
    const exit = await Effect.runPromiseExit(
      completeWebMagicLink("token", context)
    );
    return Exit.isSuccess(exit)
      ? undefined
      : Option.getOrUndefined(Exit.findErrorOption(exit))?.reason;
  };

  test("refuses another account's link without a stored reauthentication", async () => {
    // Storage refused or the marker expired: the browser's own account
    // still decides.
    expect(
      await linkReason({ nativePending: false, storedUserId: Option.none() })
    ).toBe("account-switch");
    expect(signOuts).toBe(1);
  });

  test("refuses another account's link against the stored account", async () => {
    readSession = async () => ({ data: null, error: null });
    expect(
      await linkReason({
        nativePending: false,
        storedUserId: Option.some("ada"),
      })
    ).toBe("account-switch");
  });

  test("accepts the same account's link", async () => {
    linkAccount = "ada";
    expect(
      await linkReason({ nativePending: false, storedUserId: Option.none() })
    ).toBeUndefined();
    expect(signOuts).toBe(0);
  });

  test("signs a signed-out browser in", async () => {
    readSession = async () => ({ data: null, error: null });
    expect(
      await linkReason({ nativePending: false, storedUserId: Option.none() })
    ).toBeUndefined();
  });

  test("leaves the account check to the app for a native handoff", async () => {
    expect(
      await linkReason({ nativePending: true, storedUserId: Option.none() })
    ).toBeUndefined();
    expect(signOuts).toBe(0);
  });

  test("fails closed when the browser's session can't be read first", async () => {
    readSession = async () => {
      throw new TypeError("Network request failed");
    };
    expect(
      await linkReason({ nativePending: false, storedUserId: Option.none() })
    ).toBe("reauthentication-unconfirmed");
    expect(signOuts).toBe(1);
  });
});

describe("prepareReauthenticationEmail", () => {
  const prepareReason = async (
    expectation: Parameters<typeof prepareReauthenticationEmail>[0]
  ) => {
    const exit = await Effect.runPromiseExit(
      prepareReauthenticationEmail(expectation)
    );
    return Exit.isSuccess(exit)
      ? undefined
      : Option.getOrUndefined(Exit.findErrorOption(exit))?.reason;
  };

  test("sends an ordinary sign-in email as is", async () => {
    useStorage(false);
    expect(await prepareReason({ kind: "none" })).toBeUndefined();
  });

  test("stores the account before a reauthentication email", async () => {
    useStorage(true);
    expect(await prepareReason({ kind: "account", userId: "ada" })).toBe(
      undefined
    );
    expect(loadReauthenticatingUser(Date.now())).toEqual(Option.some("ada"));
  });

  test("stops the email when the account can't be stored or recovered", async () => {
    useStorage(false);
    expect(await prepareReason({ kind: "account", userId: "ada" })).toBe(
      "reauthentication-unavailable"
    );
    expect(await prepareReason({ kind: "unrecoverable" })).toBe(
      "reauthentication-unavailable"
    );
  });

  test("its link refuses another account after the session is gone", async () => {
    useStorage(true);
    await Effect.runPromise(
      prepareReauthenticationEmail({ kind: "account", userId: "ada" })
    );
    // Ada's session expired before Bob's link was opened.
    readSession = async () => ({ data: null, error: null });
    const exit = await Effect.runPromiseExit(
      completeWebMagicLink("token", {
        nativePending: false,
        storedUserId: loadReauthenticatingUser(Date.now()),
      })
    );
    expect(Option.getOrUndefined(Exit.findErrorOption(exit))?.reason).toBe(
      "account-switch"
    );
    expect(signOuts).toBe(1);
    clearReauthenticatingUser();
  });
});
