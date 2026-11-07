import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Option } from "effect";

type SessionRead = () => Promise<{
  readonly data: { readonly user: { readonly id: string } } | null;
  readonly error: { readonly status?: number; readonly code?: string } | null;
}>;

let readSession: SessionRead = async () => ({ data: null, error: null });
let signOuts = 0;

mock.module("./auth-client.web", () => ({
  authClient: {
    getSession: () => readSession(),
    signOut: async () => {
      signOuts += 1;
      return { data: { success: true }, error: null };
    },
  },
}));

const { confirmWebAccount, reauthenticationExpectation } = await import(
  "./web-sign-in"
);

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
