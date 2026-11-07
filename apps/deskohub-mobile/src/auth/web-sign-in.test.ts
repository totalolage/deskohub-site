import { beforeEach, describe, expect, mock, test } from "bun:test";
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

const { completeWebMagicLink, confirmWebAccount, reauthenticationExpectation } =
  await import("./web-sign-in");

const reasonOf = async (
  expectation: Parameters<typeof confirmWebAccount>[0]
): Promise<string | undefined> => {
  const exit = await Effect.runPromiseExit(confirmWebAccount(expectation));
  return Exit.isSuccess(exit)
    ? undefined
    : Option.getOrUndefined(Exit.findErrorOption(exit))?.reason;
};

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
