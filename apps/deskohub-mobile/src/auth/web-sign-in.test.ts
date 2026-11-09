import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { customerSignInLocaleHeader } from "@deskohub/workspace-customer-api/customer-locale";
import { Effect, Exit, Option } from "effect";
import { analytics } from "../analytics/analytics";

type SessionRead = () => Promise<{
  readonly data: { readonly user: { readonly id: string } } | null;
  readonly error: { readonly status?: number; readonly code?: string } | null;
}>;

let readSession: SessionRead = async () => ({ data: null, error: null });
let signOuts = 0;
/** The account a verified magic link signs the browser in to. */
let linkAccount = "bob";
/** The app locale each code or link request named. */
let namedLocales: Array<string | undefined> = [];

interface FetchOptions {
  readonly headers?: Readonly<Record<string, string>>;
}

const recordLocale = (fetchOptions: FetchOptions | undefined) => {
  namedLocales.push(fetchOptions?.headers?.[customerSignInLocaleHeader]);
};
/** What the server answers a sign-in email request with. */
let emailSent: unknown = { status: true, signInCode: true };

/** The return URIs the page asked the server to mint a handoff for. */
let mintedFor: Array<string> = [];

mock.module("./auth-client.web", () => ({
  authClient: {
    $fetch: async (
      path: string,
      { body }: { readonly body: { readonly return_uri: string } }
    ) => {
      if (path !== "/native-handoff/mint") throw new Error(path);
      mintedFor.push(body.return_uri);
      return {
        data: { url: `${body.return_uri}?code=handoff&state=attempt` },
        error: null,
      };
    },
    getSession: () => readSession(),
    signIn: {
      magicLink: async () => ({ data: emailSent, error: null }),
      emailOtp: async ({
        fetchOptions,
      }: {
        readonly fetchOptions?: FetchOptions;
      }) => {
        recordLocale(fetchOptions);
        readSession = async () => ({
          data: { user: { id: linkAccount } },
          error: null,
        });
        return { data: { token: "t" }, error: null };
      },
    },
    magicLink: {
      verify: async ({
        query,
        fetchOptions,
      }: {
        readonly query: { readonly token: string };
        readonly fetchOptions?: FetchOptions;
      }) => {
        recordLocale(fetchOptions);
        if (query.token === "used") {
          return { data: null, error: { status: 400, code: "INVALID_TOKEN" } };
        }
        // The server refuses another account's link while this browser is
        // signed in, and leaves its session as it was.
        if (query.token === "another-account") {
          return {
            data: null,
            error: { status: 403, code: "ACCOUNT_SWITCH_REFUSED" },
          };
        }
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
  finishSignIn,
  completeWebCodeSignIn,
  completeWebMagicLink,
  completeWebPasskeySignIn,
  confirmWebAccount,
  prepareNativeHandoffEmail,
  prepareReauthenticationEmail,
  reauthenticationExpectation,
  sendSignInEmail,
  signInEmailField,
} = await import("./web-sign-in");
const {
  clearReauthenticatingUser,
  loadReauthentication,
  loadReauthenticatingUser,
} = await import("./web-reauthentication-store");

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
  mintedFor = [];
  namedLocales = [];
  signOuts = 0;
  linkAccount = "bob";
  emailSent = { status: true, signInCode: true };
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

describe("signInEmailField", () => {
  const user = { id: "ada", email: testEmailAddress("ada") };

  test("locks a reauthentication to the page's signed-in account", () => {
    expect(
      signInEmailField({ reauthenticating: true, pageSession: { user } })
    ).toEqual({ kind: "locked", email: user.email });
  });

  test("sends nothing before the page's first session read", () => {
    for (const reauthenticating of [true, false]) {
      expect(
        signInEmailField({ reauthenticating, pageSession: undefined })
      ).toEqual({ kind: "waiting" });
    }
  });

  test("leaves the address free with no account to keep", () => {
    expect(
      signInEmailField({
        reauthenticating: true,
        pageSession: { user: undefined },
      })
    ).toEqual({ kind: "free" });
    expect(
      signInEmailField({ reauthenticating: false, pageSession: { user } })
    ).toEqual({ kind: "free" });
  });
});

describe("completeWebMagicLink", () => {
  const linkReason = async (
    context: Parameters<typeof completeWebMagicLink>[1]
  ): Promise<string | undefined> => {
    const exit = await Effect.runPromiseExit(
      completeWebMagicLink("token", context, "en-US")
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

  test("keeps the browser's session when the server refuses another account", async () => {
    useStorage(true);
    await Effect.runPromise(
      prepareReauthenticationEmail({ kind: "account", userId: "ada" }, "/")
    );
    const exit = await Effect.runPromiseExit(
      completeWebMagicLink(
        "another-account",
        {
          nativePending: false,
          storedUserId: loadReauthenticatingUser(Date.now()),
        },
        "en-US"
      )
    );
    expect(Option.getOrUndefined(Exit.findErrorOption(exit))?.reason).toBe(
      "account-switch"
    );
    expect(signOuts).toBe(0);
    expect((await readSession()).data?.user.id).toBe("ada");
    expect(loadReauthenticatingUser(Date.now())).toEqual(Option.some("ada"));
    clearReauthenticatingUser();
  });
});

describe("prepareReauthenticationEmail", () => {
  const prepareReason = async (
    expectation: Parameters<typeof prepareReauthenticationEmail>[0]
  ) => {
    const exit = await Effect.runPromiseExit(
      prepareReauthenticationEmail(expectation, "/")
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

  test("keeps the screen the reauthentication returns to", async () => {
    useStorage(true);
    await Effect.runPromise(
      prepareReauthenticationEmail(
        { kind: "account", userId: "ada" },
        "/account/passkeys"
      )
    );
    expect(loadReauthentication(Date.now())).toEqual(
      Option.some({
        userId: "ada",
        returnPath: Option.some("/account/passkeys"),
      })
    );
    clearReauthenticatingUser();
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
      prepareReauthenticationEmail({ kind: "account", userId: "ada" }, "/")
    );
    // Ada's session expired before Bob's link was opened.
    readSession = async () => ({ data: null, error: null });
    const exit = await Effect.runPromiseExit(
      completeWebMagicLink(
        "token",
        {
          nativePending: false,
          storedUserId: loadReauthenticatingUser(Date.now()),
        },
        "en-US"
      )
    );
    expect(Option.getOrUndefined(Exit.findErrorOption(exit))?.reason).toBe(
      "account-switch"
    );
    expect(signOuts).toBe(1);
    clearReauthenticatingUser();
  });
});

describe("the stored reauthentication outlives failed attempts", () => {
  const reasonOfExit = (
    exit: Exit.Exit<unknown, { readonly reason: string }>
  ) =>
    Exit.isSuccess(exit)
      ? undefined
      : Option.getOrUndefined(Exit.findErrorOption(exit))?.reason;

  const openLink = (token: string) =>
    Effect.runPromiseExit(
      completeWebMagicLink(
        token,
        {
          nativePending: false,
          storedUserId: loadReauthenticatingUser(Date.now()),
        },
        "en-US"
      )
    );

  test("a used link, then the other account's valid link", async () => {
    useStorage(true);
    await Effect.runPromise(
      prepareReauthenticationEmail({ kind: "account", userId: "ada" }, "/")
    );
    readSession = async () => ({ data: null, error: null });

    expect(reasonOfExit(await openLink("used"))).toBe("link-rejected");
    expect(reasonOfExit(await openLink("valid"))).toBe("account-switch");
    // A refusal keeps it too, for the email's remaining links.
    readSession = async () => ({ data: null, error: null });
    expect(reasonOfExit(await openLink("valid"))).toBe("account-switch");
    expect(loadReauthenticatingUser(Date.now())).toEqual(Option.some("ada"));
  });

  test("a refused code, then the email's link", async () => {
    useStorage(true);
    await Effect.runPromise(
      prepareReauthenticationEmail({ kind: "account", userId: "ada" }, "/")
    );
    const codeExit = await Effect.runPromiseExit(
      completeWebCodeSignIn(
        testEmailAddress("bob"),
        "123456",
        { kind: "account", userId: "ada" },
        "en-US"
      )
    );
    expect(reasonOfExit(codeExit)).toBe("account-switch");
    readSession = async () => ({ data: null, error: null });
    expect(reasonOfExit(await openLink("valid"))).toBe("account-switch");
  });

  test("a confirmed sign-in ends the reauthentication", async () => {
    useStorage(true);
    linkAccount = "ada";
    await Effect.runPromise(
      prepareReauthenticationEmail({ kind: "account", userId: "ada" }, "/")
    );
    expect(reasonOfExit(await openLink("valid"))).toBeUndefined();
    expect(loadReauthenticatingUser(Date.now())).toEqual(Option.none());
  });
});

describe("completeWebPasskeySignIn", () => {
  const reasonOfPasskey = async (
    expectation: Parameters<typeof completeWebPasskeySignIn>[0]
  ) => {
    const exit = await Effect.runPromiseExit(
      completeWebPasskeySignIn(expectation)
    );
    return Exit.isSuccess(exit)
      ? undefined
      : Option.getOrUndefined(Exit.findErrorOption(exit))?.reason;
  };

  test("finishes an ordinary passkey sign-in as any account", async () => {
    readSession = async () => ({ data: { user: { id: "bob" } }, error: null });
    expect(await reasonOfPasskey({ kind: "none" })).toBeUndefined();
    expect(signOuts).toBe(0);
  });

  test("refuses a reauthentication's passkey for another account", async () => {
    useStorage(true);
    await Effect.runPromise(
      prepareReauthenticationEmail({ kind: "account", userId: "ada" }, "/")
    );
    readSession = async () => ({ data: { user: { id: "bob" } }, error: null });
    expect(await reasonOfPasskey({ kind: "account", userId: "ada" })).toBe(
      "account-switch"
    );
    expect(signOuts).toBe(1);
    // The email's links are still checked against the stored account.
    expect(loadReauthenticatingUser(Date.now())).toEqual(Option.some("ada"));
    clearReauthenticatingUser();
  });

  test("refuses a passkey when the reauthentication's account is unknown", async () => {
    expect(await reasonOfPasskey({ kind: "unrecoverable" })).toBe(
      "reauthentication-unconfirmed"
    );
    expect(signOuts).toBe(1);
  });

  test("ends a reauthentication its passkey confirms", async () => {
    useStorage(true);
    await Effect.runPromise(
      prepareReauthenticationEmail({ kind: "account", userId: "ada" }, "/")
    );
    expect(
      await reasonOfPasskey({ kind: "account", userId: "ada" })
    ).toBeUndefined();
    expect(signOuts).toBe(0);
    expect(loadReauthenticatingUser(Date.now())).toEqual(Option.none());
  });
});

describe("prepareNativeHandoffEmail", () => {
  const request = {
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    state: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    returnUri: "deskohub://auth/callback",
    reauthenticate: true,
  };
  const reasonOfPrepare = async (
    input: Parameters<typeof prepareNativeHandoffEmail>[0]
  ) => {
    const exit = await Effect.runPromiseExit(prepareNativeHandoffEmail(input));
    return Exit.isSuccess(exit)
      ? undefined
      : Option.getOrUndefined(Exit.findErrorOption(exit))?.reason;
  };

  test("sends while the app's request is live, or without one", async () => {
    expect(
      await reasonOfPrepare({
        openedByApp: true,
        currentRequest: Option.some(request),
      })
    ).toBeUndefined();
    expect(
      await reasonOfPrepare({
        openedByApp: false,
        currentRequest: Option.none(),
      })
    ).toBeUndefined();
  });

  test("stops a late email once the app's request expired", async () => {
    expect(
      await reasonOfPrepare({
        openedByApp: true,
        currentRequest: Option.none(),
      })
    ).toBe("native-request-expired");
  });
});

describe("finishSignIn", () => {
  const request = {
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    state: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    returnUri: "deskohub://auth/callback",
    reauthenticate: false,
  };

  test("tells the app a continued session signed in with the continue method", async () => {
    const destination = await Effect.runPromise(
      finishSignIn(Option.some(request), "continue")
    );

    expect(mintedFor).toEqual([request.returnUri]);
    expect(destination.kind).toBe("app");
    const url = new URL(destination.kind === "app" ? destination.url : "");
    expect(url.searchParams.get("method")).toBe("continue");
    expect(url.searchParams.get("code")).toBe("handoff");
  });

  test("records a sign-in the browser finished itself, without minting", async () => {
    const captured: Array<unknown> = [];
    const capture = spyOn(analytics, "capture").mockImplementation((event) => {
      captured.push(event);
    });
    try {
      const destination = await Effect.runPromise(
        finishSignIn(Option.none(), "code")
      );

      expect(destination).toEqual({ kind: "web" });
      expect(mintedFor).toEqual([]);
      expect(captured).toEqual([
        {
          name: "sign-in completed",
          properties: { method: "code" },
          awaitsAccount: true,
        },
      ]);
    } finally {
      capture.mockRestore();
    }
  });
});

describe("the app's locale", () => {
  test("the code and link requests name it", async () => {
    await Effect.runPromise(
      completeWebCodeSignIn(
        testEmailAddress("ada"),
        "123456",
        { kind: "none" },
        "cs-CZ"
      )
    );
    await Effect.runPromise(
      completeWebMagicLink(
        "token",
        { nativePending: true, storedUserId: Option.none() },
        "en-US"
      )
    );

    expect(namedLocales).toEqual(["cs-CZ", "en-US"]);
  });
});

describe("sendSignInEmail", () => {
  const email = testEmailAddress("ada");
  const send = () => Effect.runPromise(sendSignInEmail(email, "en-US"));

  test("reports a code when the server issued one", async () => {
    expect(await send()).toEqual({ email, signInCode: true });
  });

  test("reports a link-only email when the server issued no code", async () => {
    emailSent = { status: true, signInCode: false };
    expect(await send()).toEqual({ email, signInCode: false });
  });

  test("treats an answer without the decision as link-only", async () => {
    emailSent = { status: true };
    expect(await send()).toEqual({ email, signInCode: false });
    emailSent = null;
    expect(await send()).toEqual({ email, signInCode: false });
  });

  test("takes only a literal yes as a code", async () => {
    emailSent = { status: true, signInCode: "true" };
    expect(await send()).toEqual({ email, signInCode: false });
  });
});
