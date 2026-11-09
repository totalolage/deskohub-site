import { beforeEach, describe, expect, mock, test } from "bun:test";

type SignOutResult = {
  readonly error: null | {
    readonly message?: string;
    readonly status?: number;
  };
};

const events: string[] = [];
const beginAnalyticsAccountTransition = mock(() => {
  events.push("begin");
});
const completeAnalyticsAccountSignOut = mock(() => {
  events.push("complete");
});
const refreshAnalyticsAccountIdentity = mock(
  (_options?: { readonly settleTransition?: true }) => {
    events.push("refresh");
    return Promise.resolve();
  }
);
const signOut = mock(
  (): Promise<SignOutResult> => Promise.resolve({ error: null })
);

mock.module("@/features/account/analytics-identity", () => ({
  beginAnalyticsAccountTransition,
  completeAnalyticsAccountSignOut,
  refreshAnalyticsAccountIdentity,
}));

mock.module("@/features/account/auth.client", () => ({
  authClient: { signOut },
}));

const { beginAccountExit, signOutOfAccount } = await import("./account-exit");

beforeEach(() => {
  events.length = 0;
  beginAnalyticsAccountTransition.mockClear();
  completeAnalyticsAccountSignOut.mockClear();
  refreshAnalyticsAccountIdentity.mockClear();
  refreshAnalyticsAccountIdentity.mockImplementation(() => {
    events.push("refresh");
    return Promise.resolve();
  });
  signOut.mockClear();
  signOut.mockImplementation(() => Promise.resolve({ error: null }));
});

describe("beginAccountExit", () => {
  test("pauses analytics as soon as the exit begins", () => {
    beginAccountExit();

    expect(events).toEqual(["begin"]);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).not.toHaveBeenCalled();
  });

  test("resets analytics once when the account is left", () => {
    const exit = beginAccountExit();

    exit.left();
    exit.left();
    exit.stayed();

    expect(events).toEqual(["begin", "complete"]);
    expect(refreshAnalyticsAccountIdentity).not.toHaveBeenCalled();
  });

  test("settles the transition from the session once when the account stays", () => {
    const exit = beginAccountExit();

    exit.stayed();
    exit.stayed();
    exit.left();

    expect(events).toEqual(["begin", "refresh"]);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
  });

  test("settles each exit on its own", () => {
    const first = beginAccountExit();
    first.stayed();
    const second = beginAccountExit();
    first.left();
    second.left();

    expect(events).toEqual(["begin", "refresh", "begin", "complete"]);
  });

  test("returns while the settling refresh is still running", () => {
    refreshAnalyticsAccountIdentity.mockImplementation(() => {
      events.push("refresh");
      return new Promise<void>(() => undefined);
    });
    const exit = beginAccountExit();

    expect(() => exit.stayed()).not.toThrow();
    expect(events).toEqual(["begin", "refresh"]);
  });
});

describe("signOutOfAccount", () => {
  test("resets analytics only after the sign-out request succeeds", async () => {
    let resolveSignOut!: (result: SignOutResult) => void;
    signOut.mockImplementationOnce(() => {
      events.push("request");
      return new Promise<SignOutResult>((resolve) => {
        resolveSignOut = resolve;
      });
    });

    const outcome = signOutOfAccount();
    expect(events).toEqual(["begin", "request"]);

    resolveSignOut({ error: null });

    expect(await outcome).toBe("signed-out");
    expect(events).toEqual(["begin", "request", "complete"]);
    expect(refreshAnalyticsAccountIdentity).not.toHaveBeenCalled();
  });

  test("keeps the account and settles from the session when sign-out resolves with an error", async () => {
    signOut.mockImplementationOnce(() =>
      Promise.resolve({
        error: { message: "service unavailable", status: 503 },
      })
    );

    expect(await signOutOfAccount()).toBe("failed");
    expect(events).toEqual(["begin", "refresh"]);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith({
      settleTransition: true,
    });
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
  });

  test("withholds a rejected sign-out and settles from the session", async () => {
    signOut.mockImplementationOnce(() =>
      Promise.reject(new Error("raw provider failure"))
    );

    expect(await signOutOfAccount()).toBe("failed");
    expect(events).toEqual(["begin", "refresh"]);
    expect(completeAnalyticsAccountSignOut).not.toHaveBeenCalled();
  });

  test("begins a fresh exit for each attempt", async () => {
    signOut
      .mockImplementationOnce(() => Promise.resolve({ error: { status: 503 } }))
      .mockImplementationOnce(() => Promise.resolve({ error: null }));

    expect(await signOutOfAccount()).toBe("failed");
    expect(await signOutOfAccount()).toBe("signed-out");
    expect(events).toEqual(["begin", "refresh", "begin", "complete"]);
  });
});
