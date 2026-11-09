import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  deliverWorkspaceBrowserLogs,
  discardWorkspaceBrowserLogs,
  type WorkspaceBrowserLogRecord,
} from "@/shared/browser/workspace-browser-logs";
import { customerAccountIdSchema } from "./customer-account";

// An address outside the test domain stands for an ordinary customer.
const customerEmail = resendSimulatorAddress("delivered", "synthetic");

type SessionQuery = {
  readonly query?: {
    readonly disableCookieCache?: boolean;
  };
};

type SessionSnapshot = {
  readonly data: unknown;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly isRefetching: boolean;
  readonly refetch: (query?: SessionQuery) => Promise<void>;
};

type SessionListener = (snapshot: SessionSnapshot) => void;

const initialSession: SessionSnapshot = {
  data: null,
  error: null,
  isPending: true,
  isRefetching: false,
  refetch: async () => undefined,
};

let currentSession = initialSession;
const sessionListeners = new Set<SessionListener>();
const refetchRequests: Array<{
  readonly query: SessionQuery | undefined;
  readonly resolve: () => void;
}> = [];

const refetch = (query?: SessionQuery) =>
  new Promise<void>((resolve) => {
    refetchRequests.push({ query, resolve });
  });

currentSession = { ...initialSession, refetch };

const sessionAtom = {
  get: () => currentSession,
  subscribe: (listener: SessionListener) => {
    sessionListeners.add(listener);
    listener(currentSession);
    return () => {
      sessionListeners.delete(listener);
    };
  },
};

mock.module("./auth.client", () => ({
  authClient: { useSession: sessionAtom },
}));

let analyticsIdentity: typeof import("./analytics-identity");
let unsubscribe: (() => void) | undefined;

const futureExpiry = () => new Date(Date.now() + 60_000);

const authenticatedSession = (
  accountId: string,
  overrides: {
    readonly email?: unknown;
    readonly emailVerified?: boolean;
    readonly expiresAt?: Date;
  } = {}
): SessionSnapshot => ({
  data: {
    session: {
      expiresAt: overrides.expiresAt ?? futureExpiry(),
      token: "session-token-must-not-leave-adapter",
    },
    user: {
      email: "email" in overrides ? overrides.email : customerEmail,
      emailVerified: overrides.emailVerified ?? true,
      id: accountId,
      name: "Synthetic User",
    },
  },
  error: null,
  isPending: false,
  isRefetching: false,
  refetch,
});

const anonymousSession = (): SessionSnapshot => ({
  data: null,
  error: null,
  isPending: false,
  isRefetching: false,
  refetch,
});

const setSession = (next: SessionSnapshot) => {
  currentSession = next;
  for (const listener of sessionListeners) listener(next);
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const resolveNextRefetch = async (next = currentSession) => {
  const request = refetchRequests.shift();
  if (!request) throw new Error("No pending refetch request");
  setSession(next);
  request.resolve();
  await flushMicrotasks();
};

const drainRefetches = async () => {
  while (refetchRequests.length > 0) {
    await resolveNextRefetch(anonymousSession());
  }
  await flushMicrotasks();
};

const accountId = (value: string) => customerAccountIdSchema.make(value);

describe("analytics account identity", () => {
  beforeAll(async () => {
    GlobalRegistrator.register();
    analyticsIdentity = await import("./analytics-identity");
  });

  beforeEach(async () => {
    setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    unsubscribe?.();
    unsubscribe = undefined;
    setSession(anonymousSession());

    const refresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    await drainRefetches();
    await refresh;
    await flushMicrotasks();

    refetchRequests.length = 0;
    localStorage.clear();
  });

  afterEach(async () => {
    unsubscribe?.();
    unsubscribe = undefined;
    await drainRefetches();
    setSystemTime();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("starts pending, then resolves anonymous through the authoritative atom refresh", async () => {
    const observed: string[] = [];
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(() => {
      observed.push(analyticsIdentity.getAnalyticsAccountIdentity().status);
    });

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);
    expect(refetchRequests[0]?.query).toEqual({
      query: { disableCookieCache: true },
    });

    await resolveNextRefetch(anonymousSession());

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "anonymous",
    });
    expect(observed).toEqual(["pending", "anonymous"]);
  });

  test("publishes only a verified, nonexpired account ID", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());

    setSession(authenticatedSession("synthetic-account-a"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });
    expect(
      JSON.stringify(analyticsIdentity.getAnalyticsAccountIdentity())
    ).not.toContain(customerEmail);
    expect(
      JSON.stringify(analyticsIdentity.getAnalyticsAccountIdentity())
    ).not.toContain("session-token");
  });

  test("flags an account whose verified email is on the test domain without publishing the email", async () => {
    const testAccountEmail = testEmailAddress("synthetic");
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());

    setSession(
      authenticatedSession("synthetic-account-a", { email: testAccountEmail })
    );

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: true,
    });
    expect(
      JSON.stringify(analyticsIdentity.getAnalyticsAccountIdentity())
    ).not.toContain(testAccountEmail);
  });

  test("treats an account without a readable email as an ordinary account", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());

    setSession(authenticatedSession("synthetic-account-a", { email: 42 }));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });
  });

  test("fails closed for unverified, malformed, and invalid session data", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());

    setSession(
      authenticatedSession("synthetic-account-a", { emailVerified: false })
    );
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "unavailable",
    });

    setSession({
      ...authenticatedSession("synthetic-account-a"),
      data: { user: { id: "synthetic-account-a", emailVerified: true } },
    });
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "unavailable",
    });

    setSession({
      ...authenticatedSession("synthetic-account-a"),
      data: { user: { id: "synthetic-account-a", emailVerified: true } },
      isRefetching: true,
    });
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    setSession(authenticatedSession("   "));
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "unavailable",
    });
  });

  test("does not attribute retained data while the atom is pending or unavailable", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));
    expect(analyticsIdentity.getAnalyticsAccountIdentity().status).toBe(
      "authenticated"
    );

    setSession({
      ...currentSession,
      isRefetching: true,
    });
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    setSession({
      ...currentSession,
      error: new Error("synthetic transport failure"),
      isRefetching: false,
    });
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "unavailable",
    });
  });

  test("guards a published account against expiry between atom updates", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(
      authenticatedSession("synthetic-account-a", {
        expiresAt: new Date("2026-09-11T12:00:01.000Z"),
      })
    );

    expect(analyticsIdentity.getAnalyticsAccountIdentity().status).toBe(
      "authenticated"
    );

    setSystemTime(new Date("2026-09-11T12:00:01.001Z"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    setSession(
      authenticatedSession("synthetic-account-a", {
        expiresAt: new Date(Date.now() + 60_000),
      })
    );
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    await resolveNextRefetch(anonymousSession());
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "anonymous",
    });
  });

  test("refreshes authoritatively when a published account expires", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(
      authenticatedSession("synthetic-account-a", {
        expiresAt: new Date(Date.now() + 5),
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(anonymousSession());

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "anonymous",
    });
  });

  test("deduplicates equivalent snapshots and tears down the atom subscription", async () => {
    let notifications = 0;
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(() => {
      notifications += 1;
    });
    await resolveNextRefetch(anonymousSession());
    notifications = 0;

    setSession(anonymousSession());

    expect(notifications).toBe(0);
    unsubscribe();
    unsubscribe = undefined;
    setSession(authenticatedSession("synthetic-account-a"));
    expect(notifications).toBe(0);
  });

  test("publishes anonymous before refresh, then identifies a later login with the same account", async () => {
    const observed: string[] = [];
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(() => {
      observed.push(analyticsIdentity.getAnalyticsAccountIdentity().status);
    });
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));
    observed.length = 0;

    analyticsIdentity.completeAnalyticsAccountSignOut();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(observed).toEqual(["anonymous", "pending"]);
    expect(localStorage.length).toBe(1);
    expect(
      localStorage.getItem("deskohub.account-session-change")
    ).not.toContain("synthetic-account-a");

    await resolveNextRefetch(anonymousSession());

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "anonymous",
    });
    expect(observed).toEqual(["anonymous", "pending", "anonymous"]);

    setSession(authenticatedSession("synthetic-account-a"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });
  });

  test("accepts a later authoritative return to the same account after confirmed sign-out", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));

    analyticsIdentity.completeAnalyticsAccountSignOut();
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    await resolveNextRefetch(anonymousSession());
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "anonymous",
    });

    const laterRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));
    await laterRefresh;

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });
  });

  test("uses distinct opaque markers for successive account-session-change signals", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));

    analyticsIdentity.completeAnalyticsAccountSignOut();
    const firstMarker = localStorage.getItem("deskohub.account-session-change");

    analyticsIdentity.completeAnalyticsAccountSignOut();
    const secondMarker = localStorage.getItem(
      "deskohub.account-session-change"
    );

    expect(firstMarker !== null).toBe(true);
    expect(secondMarker !== null).toBe(true);
    if (firstMarker === null || secondMarker === null) {
      throw new Error("Sign-out notification marker was not stored");
    }

    expect(firstMarker === secondMarker).toBe(false);
    for (const marker of [firstMarker, secondMarker]) {
      expect(marker.includes("synthetic-account-a")).toBe(false);
      expect(marker.includes(customerEmail)).toBe(false);
      expect(marker.includes("session-token-must-not-leave-adapter")).toBe(
        false
      );
    }
  });

  test("notifies when an initial authoritative session resolves to an account", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    localStorage.clear();

    await resolveNextRefetch(authenticatedSession("synthetic-account-b"));

    expect(
      localStorage.getItem("deskohub.account-session-change") !== null
    ).toBe(true);
  });

  test("notifies when a settled account changes to another account", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));
    localStorage.clear();

    setSession(authenticatedSession("synthetic-account-b"));

    expect(
      localStorage.getItem("deskohub.account-session-change") !== null
    ).toBe(true);
  });

  test("does not notify when an account refresh resolves to the same account", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));
    localStorage.clear();

    const refresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));
    await refresh;

    expect(
      localStorage.getItem("deskohub.account-session-change") === null
    ).toBe(true);
  });

  test("converges after a remote account change without rebroadcasting the same account", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));
    localStorage.clear();

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "deskohub.account-session-change",
        newValue: "synthetic-storage-signal",
      })
    );
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    await resolveNextRefetch(authenticatedSession("synthetic-account-b"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-b"),
      status: "authenticated",
      testAccount: false,
    });
    const markerAfterAccountB = localStorage.getItem(
      "deskohub.account-session-change"
    );
    expect(markerAfterAccountB !== null).toBe(true);

    const refresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    await resolveNextRefetch(authenticatedSession("synthetic-account-b"));
    await refresh;

    expect(
      localStorage.getItem("deskohub.account-session-change") ===
        markerAfterAccountB
    ).toBe(true);
  });

  test("notifies exactly once for confirmed sign-out", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));
    localStorage.clear();

    const originalRandomUUID = crypto.randomUUID;
    let randomUUIDCalls = 0;
    crypto.randomUUID = () => {
      randomUUIDCalls += 1;
      return originalRandomUUID.call(crypto);
    };

    try {
      analyticsIdentity.completeAnalyticsAccountSignOut();
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }

    expect(randomUUIDCalls).toBe(1);
  });

  test("accepts an immediate post-sign-out response for the same account, not the obsolete response", async () => {
    const observed: string[] = [];
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(() => {
      observed.push(analyticsIdentity.getAnalyticsAccountIdentity().status);
    });
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));

    const obsoleteRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    observed.length = 0;
    analyticsIdentity.completeAnalyticsAccountSignOut();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(observed).toEqual(["anonymous", "pending"]);

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));
    await obsoleteRefresh;

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });
  });

  test("does not masquerade as anonymous while post-sign-out refresh is pending or unavailable", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());

    const failure = new Error("synthetic post-sign-out snapshot failure");
    setSession({
      ...authenticatedSession("synthetic-account-a"),
      refetch: async () => {
        setSession({
          ...authenticatedSession("synthetic-account-a"),
          error: failure,
        });
      },
    });

    analyticsIdentity.completeAnalyticsAccountSignOut();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    await flushMicrotasks();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "unavailable",
    });
  });

  test("derives pending when the SDK remains refetching after RPC completion", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());

    setSession({
      ...authenticatedSession("synthetic-account-a"),
      isRefetching: true,
      refetch: async () => undefined,
    });

    analyticsIdentity.completeAnalyticsAccountSignOut();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    await flushMicrotasks();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
  });

  test("publishes unavailable after a failed account transition refresh", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));

    analyticsIdentity.beginAnalyticsAccountTransition();
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    const failure = new Error("synthetic transition refresh failure");
    setSession({
      ...authenticatedSession("synthetic-account-a"),
      refetch: async () => {
        throw failure;
      },
    });
    const refresh = analyticsIdentity.refreshAnalyticsAccountIdentity({
      settleTransition: true,
    });
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    await expect(refresh).resolves.toBeUndefined();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "unavailable",
    });
  });

  test("consumes an asynchronously rejected refetch without rejecting the caller refresh", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());

    const failure = new Error("synthetic asynchronous refetch failure");
    setSession({
      ...authenticatedSession("synthetic-account-a"),
      refetch: async () => {
        throw failure;
      },
    });

    const refresh = analyticsIdentity.refreshAnalyticsAccountIdentity();

    await expect(refresh).resolves.toBeUndefined();
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "unavailable",
    });
  });

  test("publishes unavailable for a failed background refresh that nobody awaits", async () => {
    let unhandledRejections = 0;
    const recordUnhandled = () => {
      unhandledRejections += 1;
    };
    process.on("unhandledRejection", recordUnhandled);
    setSession({
      ...authenticatedSession("synthetic-account-a"),
      refetch: async () => {
        throw new Error("synthetic background refetch failure");
      },
    });

    try {
      unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
        () => undefined
      );
      window.dispatchEvent(new Event("focus"));
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
        status: "unavailable",
      });
      expect(unhandledRejections).toBe(0);
    } finally {
      process.off("unhandledRejection", recordUnhandled);
    }
  });

  describe("refresh failure logs", () => {
    const refreshFailureLog: WorkspaceBrowserLogRecord = {
      attributes: {
        boundary: "browser",
        errorType: "Error",
        failureCode: "account.analytics-session.refresh-failed",
        operation: "account.analytics-identity.refresh",
      },
      body: "Workspace browser failure",
      level: "warn",
    };
    let detachLogs: (() => void) | undefined;

    // Earlier failing refreshes leave records waiting for a sink.
    const collectLogs = () => {
      discardWorkspaceBrowserLogs();
      const records: WorkspaceBrowserLogRecord[] = [];
      detachLogs = deliverWorkspaceBrowserLogs((record) =>
        records.push(record)
      );
      return records;
    };

    const settleLogs = () => new Promise((resolve) => setTimeout(resolve, 0));

    afterEach(() => {
      detachLogs?.();
      detachLogs = undefined;
      discardWorkspaceBrowserLogs();
    });

    test("logs each failed refetch once with a stable code and no payload", async () => {
      unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
        () => undefined
      );
      await resolveNextRefetch(anonymousSession());
      const records = collectLogs();

      const failure = new Error(
        `synthetic refetch failure for ${customerEmail} with session-token`
      );
      setSession({
        ...authenticatedSession("synthetic-account-a"),
        refetch: async () => {
          throw failure;
        },
      });

      await expect(
        analyticsIdentity.refreshAnalyticsAccountIdentity()
      ).resolves.toBeUndefined();
      await settleLogs();
      expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
        status: "unavailable",
      });
      expect(records).toEqual([refreshFailureLog]);

      await expect(
        analyticsIdentity.refreshAnalyticsAccountIdentity()
      ).resolves.toBeUndefined();
      await settleLogs();
      expect(records).toEqual([refreshFailureLog, refreshFailureLog]);
      expect(JSON.stringify(records)).not.toContain(customerEmail);
      expect(JSON.stringify(records)).not.toContain("session-token");
    });

    test("logs a refetch that resolves with a failed session request once", async () => {
      unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
        () => undefined
      );
      await resolveNextRefetch(anonymousSession());
      const records = collectLogs();

      await Promise.all([
        analyticsIdentity.refreshAnalyticsAccountIdentity(),
        resolveNextRefetch({
          ...authenticatedSession("synthetic-account-a"),
          error: {
            message: `session unavailable for ${customerEmail}`,
            status: 503,
            statusText: "Service Unavailable",
          },
        }),
      ]);
      await settleLogs();

      expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
        status: "unavailable",
      });
      expect(records).toEqual([
        {
          ...refreshFailureLog,
          attributes: {
            ...refreshFailureLog.attributes,
            errorType: "unclassified",
            status: 503,
          },
        },
      ]);
      expect(JSON.stringify(records)).not.toContain(customerEmail);
    });

    test("keeps the refresh outcome when the log sink throws", async () => {
      let unhandledRejections = 0;
      const recordUnhandled = () => {
        unhandledRejections += 1;
      };
      process.on("unhandledRejection", recordUnhandled);
      unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
        () => undefined
      );
      await resolveNextRefetch(anonymousSession());
      let sinkCalls = 0;
      discardWorkspaceBrowserLogs();
      detachLogs = deliverWorkspaceBrowserLogs(() => {
        sinkCalls += 1;
        throw new Error("synthetic log sink failure");
      });

      const failure = new Error("synthetic refetch failure");
      setSession({
        ...authenticatedSession("synthetic-account-a"),
        refetch: async () => {
          throw failure;
        },
      });

      try {
        await expect(
          analyticsIdentity.refreshAnalyticsAccountIdentity()
        ).resolves.toBeUndefined();
        await settleLogs();

        expect(sinkCalls).toBe(1);
        expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
          status: "unavailable",
        });
        expect(unhandledRejections).toBe(0);
      } finally {
        process.off("unhandledRejection", recordUnhandled);
      }
    });
  });

  test("holds pending through older and autoqueued refreshes until explicit mutation outcome", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));

    let resolveMutationFailure = () => undefined;
    const mutationFailure = new Promise<void>((resolve) => {
      resolveMutationFailure = resolve;
    });
    const olderRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    analyticsIdentity.beginAnalyticsAccountTransition();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    setSession({
      ...authenticatedSession("synthetic-account-a"),
      isRefetching: true,
    });
    setSession(authenticatedSession("synthetic-account-a"));
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    const routineRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));
    await routineRefresh;

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    resolveMutationFailure();
    await mutationFailure;

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    const outcomeRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity({
      settleTransition: true,
    });
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));
    await Promise.all([olderRefresh, outcomeRefresh]);

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });
  });

  test("advances the epoch for an explicit refresh before accepting a fresh account", async () => {
    const observed: Array<
      ReturnType<typeof analyticsIdentity.getAnalyticsAccountIdentity>
    > = [];
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(() => {
      observed.push(analyticsIdentity.getAnalyticsAccountIdentity());
    });
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));
    observed.length = 0;

    const olderRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    setSession(authenticatedSession("synthetic-account-b"));
    const explicitRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(observed).not.toContainEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(authenticatedSession("synthetic-account-b"));
    await Promise.all([olderRefresh, explicitRefresh]);

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-b"),
      status: "authenticated",
      testAccount: false,
    });
  });

  test("advances past a mutation-time account read before accepting an anonymous outcome", async () => {
    const observed: Array<
      ReturnType<typeof analyticsIdentity.getAnalyticsAccountIdentity>
    > = [];
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(() => {
      observed.push(analyticsIdentity.getAnalyticsAccountIdentity());
    });
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));

    analyticsIdentity.beginAnalyticsAccountTransition();
    observed.length = 0;
    const olderRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    const outcomeRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity({
      settleTransition: true,
    });

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(observed).not.toContainEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(anonymousSession());
    await Promise.all([olderRefresh, outcomeRefresh]);

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "anonymous",
    });
  });

  test("queues a fresh request when an external signal invalidates an in-flight refresh", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));

    const olderRefresh = analyticsIdentity.refreshAnalyticsAccountIdentity();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    await resolveNextRefetch(authenticatedSession("synthetic-account-b"));
    await olderRefresh;

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-b"),
      status: "authenticated",
      testAccount: false,
    });
  });

  test("starts a fresh request when focus interrupts an SDK-owned refresh", async () => {
    const observed: Array<
      ReturnType<typeof analyticsIdentity.getAnalyticsAccountIdentity>
    > = [];
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(() => {
      observed.push(analyticsIdentity.getAnalyticsAccountIdentity());
    });
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));
    observed.length = 0;

    const externalA = refetch();
    const externalARequest = refetchRequests.shift();
    if (!externalARequest) throw new Error("External A did not start");
    setSession({
      ...authenticatedSession("synthetic-account-a"),
      isRefetching: true,
      refetch: (query) => (query === undefined ? externalA : refetch(query)),
    });
    observed.length = 0;

    // Better Auth 1.7.2's dist/client/session-atom.mjs fetchSession (lines
    // 126-145) cancels its older flight before starting this refetch.
    window.dispatchEvent(new Event("focus"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(refetchRequests).toHaveLength(1);

    externalARequest.resolve();
    await externalA;
    setSession(authenticatedSession("synthetic-account-a"));
    await flushMicrotasks();

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    expect(observed).not.toContainEqual({
      accountId: accountId("synthetic-account-a"),
      status: "authenticated",
      testAccount: false,
    });

    await resolveNextRefetch(authenticatedSession("synthetic-account-b"));

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      accountId: accountId("synthetic-account-b"),
      status: "authenticated",
      testAccount: false,
    });
  });

  test("pauses synchronously for focus, visibility, online, and account-session-change signals", async () => {
    unsubscribe = analyticsIdentity.subscribeAnalyticsAccountIdentity(
      () => undefined
    );
    await resolveNextRefetch(anonymousSession());
    setSession(authenticatedSession("synthetic-account-a"));

    window.dispatchEvent(new Event("focus"));
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    document.dispatchEvent(new Event("visibilitychange"));
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    window.dispatchEvent(new Event("online"));
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    await resolveNextRefetch(authenticatedSession("synthetic-account-a"));

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "deskohub.account-session-change",
        newValue: "synthetic-marker-only",
      })
    );
    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "pending",
    });
    await resolveNextRefetch(anonymousSession());

    expect(analyticsIdentity.getAnalyticsAccountIdentity()).toEqual({
      status: "anonymous",
    });
  });
});
