import { describe, expect, test } from "bun:test";
import type { AnalyticsConsentStatus } from "../consent/analytics-consent";
import { type AnalyticsRuntime, createAnalytics } from "./analytics";
import type { AnalyticsSettings } from "./analytics-settings";
import {
  type FakeAnalyticsClient,
  makeFakeAnalyticsClient,
} from "./testing/fake-analytics-client";

const settings: AnalyticsSettings = {
  apiKey: "phc_test",
  host: "https://t.example.test",
  environment: "production",
};

const setup = ({
  consent = "granted",
  runtimeSettings = settings,
  otherSdk = false,
  restoredDistinctId = null,
  holdLoading = false,
  accountCheck = false,
  failedStoredStateClears = 0,
}: {
  readonly consent?: AnalyticsConsentStatus;
  readonly runtimeSettings?: AnalyticsSettings | null;
  readonly otherSdk?: boolean;
  /** The identity the SDK's stored state already holds. */
  readonly restoredDistinctId?: string | null;
  /** Keeps each client loading until the test finishes it. */
  readonly holdLoading?: boolean;
  /** Holds signed-in delivery until the test settles the account's check. */
  readonly accountCheck?: boolean;
  /** How many attempts to clear the stored state fail before one succeeds. */
  readonly failedStoredStateClears?: number;
} = {}) => {
  const analytics = createAnalytics();
  const clients: FakeAnalyticsClient[] = [];
  const warnings: string[] = [];
  let status = consent;
  const consentListeners = new Set<() => void>();
  const checkListeners = new Set<() => void>();
  const checkedAccounts = new Set<string>();
  let storedStateClears = 0;
  // A client restores this identity until a clear succeeds.
  let storedDistinctId = restoredDistinctId;
  const runtime: AnalyticsRuntime = {
    settings: runtimeSettings,
    createClient: (options) => {
      const fake = makeFakeAnalyticsClient(
        options,
        storedDistinctId,
        holdLoading
      );
      clients.push(fake);
      return fake.client;
    },
    detectOtherSdk: () => otherSdk,
    consent: {
      status: () => status,
      subscribe: (listener) => {
        consentListeners.add(listener);
        return () => consentListeners.delete(listener);
      },
    },
    ...(accountCheck
      ? {
          accountCheck: {
            holds: (accountId) => !checkedAccounts.has(accountId),
            subscribe: (listener) => {
              checkListeners.add(listener);
              return () => checkListeners.delete(listener);
            },
          },
        }
      : {}),
    clearStoredState: async () => {
      storedStateClears++;
      if (storedStateClears <= failedStoredStateClears) {
        throw new Error("storage");
      }
      storedDistinctId = null;
    },
    warn: (message) => warnings.push(message),
  };
  const notifyCheck = () => {
    for (const listener of checkListeners) listener();
  };
  return {
    analytics,
    clients,
    warnings,
    connect: () => analytics.connect(runtime),
    setConsent: (next: AnalyticsConsentStatus) => {
      status = next;
      for (const listener of consentListeners) listener();
    },
    /** The account's consent check finished. */
    settleCheck: (accountId: string) => {
      checkedAccounts.add(accountId);
      notifyCheck();
    },
    /** The app returned to the foreground: every account is checked again. */
    recheck: () => {
      checkedAccounts.clear();
      notifyCheck();
    },
    storedStateClears: () => storedStateClears,
  };
};

const account = (accountId: string, testAccount = false) =>
  ({ kind: "authenticated", accountId, testAccount }) as const;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("client construction", () => {
  test("waits for granted consent", async () => {
    const app = setup({ consent: "undecided" });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    expect(app.clients).toHaveLength(0);

    app.setConsent("granted");
    expect(app.clients).toHaveLength(1);
  });

  test("never constructs on a denied or still-loading answer", () => {
    for (const consent of ["denied", "loading"] as const) {
      const app = setup({ consent });
      app.connect();
      app.analytics.setIdentity({ kind: "anonymous" });
      expect(app.clients).toHaveLength(0);
    }
  });

  test("waits for the identity to settle", () => {
    const app = setup();
    app.connect();
    expect(app.clients).toHaveLength(0);

    app.analytics.setIdentity({ kind: "anonymous" });
    expect(app.clients).toHaveLength(1);
  });

  test("stays off without settings", async () => {
    const app = setup({ runtimeSettings: null });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.analytics.capture({ name: "access PIN viewed" });
    await settle();
    expect(app.clients).toHaveLength(0);
  });

  test("passes the key, host and deployment environment", () => {
    const app = setup({
      runtimeSettings: { ...settings, environment: "preview" },
    });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    expect(app.clients[0]?.options).toEqual({
      apiKey: "phc_test",
      host: "https://t.example.test",
      remoteFeatureFlags: false,
      superProperties: { "deployment.environment.name": "preview" },
    });
  });

  test("loads flags for an anonymous identity", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    expect(app.clients[0]?.options.remoteFeatureFlags).toBe(true);
    expect(app.clients[0]?.calls).toEqual([["reloadFeatureFlags"]]);
  });

  test.each(["preview", "development"] as const)(
    "requests no remote flags in %s",
    async (environment) => {
      const app = setup({
        runtimeSettings: { ...settings, environment },
        restoredDistinctId: "workspace-account:account-a",
      });
      app.connect();
      app.analytics.setIdentity({ kind: "anonymous" });
      await settle();
      app.analytics.setIdentity(account("account-b"));
      await settle();
      const [client] = app.clients;
      expect(client?.options.remoteFeatureFlags).toBe(false);
      expect(client?.calls.map(([name]) => name)).toContain("identify");
      expect(client?.calls.map(([name]) => name)).not.toContain(
        "reloadFeatureFlags"
      );
    }
  );

  test("refuses to start beside another PostHog SDK in the page", async () => {
    const app = setup({ otherSdk: true });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.analytics.capture({ name: "access PIN viewed" });
    await settle();
    expect(app.clients).toHaveLength(0);
    expect(app.warnings).toHaveLength(1);
  });

  test("keeps one client across repeated settles", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.setConsent("granted");
    expect(app.clients).toHaveLength(1);
  });

  test("retires a still-loading client at once on withdrawal", async () => {
    const app = setup({ holdLoading: true });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.setConsent("denied");
    expect(app.clients[0]?.calls).toEqual([["shutDown"]]);

    app.clients[0]?.finishLoading();
    await settle();
    expect(app.clients[0]?.calls).toEqual([["shutDown"]]);
  });

  test("retires a still-loading client on disconnect", () => {
    const app = setup({ holdLoading: true });
    const disconnect = app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    disconnect();
    expect(app.clients[0]?.calls).toEqual([["shutDown"]]);
  });

  test("stops after a client fails to start, until reconnected", async () => {
    const app = setup({ holdLoading: true });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.clients[0]?.failLoading();
    await settle();
    expect(app.clients[0]?.calls).toEqual([["shutDown"]]);
    app.clients[0]?.finishShutdown();
    await settle();
    app.analytics.capture({ name: "booking started" });
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    expect(app.clients).toHaveLength(1);
    expect(app.warnings).toHaveLength(1);

    app.connect();
    expect(app.clients).toHaveLength(2);
  });

  test("never reuses a client withdrawn while loading when consent returns", async () => {
    const app = setup({ holdLoading: true });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.setConsent("denied");
    app.setConsent("granted");
    app.clients[0]?.finishLoading();
    app.analytics.capture({ name: "booking started" });
    await settle();
    expect(app.clients).toHaveLength(1);

    app.clients[0]?.finishShutdown();
    await settle();
    expect(app.clients).toHaveLength(2);
    app.clients[1]?.finishLoading();
    await settle();
    expect(app.clients[0]?.calls).toEqual([["shutDown"]]);
    expect(app.clients[1]?.calls).toEqual([
      ["reloadFeatureFlags"],
      ["capture", "booking started", undefined],
    ]);
  });
});

describe("outbox", () => {
  test("delivers events held before readiness in order", async () => {
    const app = setup({ consent: "loading" });
    app.analytics.screen("/");
    app.connect();
    app.analytics.capture({ name: "booking started" });
    app.setConsent("granted");
    app.analytics.capture({
      name: "booking submitted",
      properties: { reservation_kind: "cowork" },
    });
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();

    expect(app.clients[0]?.calls).toEqual([
      ["reloadFeatureFlags"],
      ["screen", "/"],
      ["capture", "booking started", undefined],
      ["capture", "booking submitted", { reservation_kind: "cowork" }],
    ]);
  });

  test("drops events while consent is undecided or denied", async () => {
    const app = setup({ consent: "undecided" });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.analytics.capture({ name: "booking started" });
    app.setConsent("granted");
    await settle();
    expect(app.clients[0]?.calls).toEqual([["reloadFeatureFlags"]]);
  });

  test("discards held events when the answer is a refusal", async () => {
    const app = setup({ consent: "loading" });
    app.connect();
    app.analytics.capture({ name: "booking started" });
    app.setConsent("denied");
    app.setConsent("granted");
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    expect(app.clients[0]?.calls).toEqual([["reloadFeatureFlags"]]);
  });

  test("holds at most 50 events", async () => {
    const app = setup();
    app.connect();
    for (let index = 0; index < 60; index++) {
      app.analytics.capture({ name: `event ${index}` });
    }
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    const captures = app.clients[0]?.calls.filter(
      ([kind]) => kind === "capture"
    );
    expect(captures).toHaveLength(50);
    expect(captures?.[49]?.[1]).toBe("event 49");
  });

  test("holds events again while the identity is pending", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    app.analytics.setIdentity({ kind: "pending" });
    app.analytics.capture({ name: "booking started" });
    expect(app.clients[0]?.calls).toEqual([["reloadFeatureFlags"]]);

    app.analytics.setIdentity(account("acc_1"));
    expect(app.clients[0]?.calls.slice(1)).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
      ["capture", "booking started", undefined],
    ]);
  });

  test("holds account events until a signed-in identity is applied", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    app.analytics.capture({
      name: "sign-in completed",
      properties: { method: "code" },
      awaitsAccount: true,
    });
    app.analytics.capture({ name: "booking started" });
    expect(app.clients[0]?.calls.slice(1)).toEqual([
      ["capture", "booking started", undefined],
    ]);

    app.analytics.setIdentity(account("acc_1"));
    expect(app.clients[0]?.calls.slice(2)).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
      ["capture", "sign-in completed", { method: "code" }],
    ]);
  });
});

describe("identity", () => {
  test("identifies a signed-in account without contact properties", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    await settle();
    expect(app.clients[0]?.calls).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
    ]);
  });

  test("marks test accounts internal in production", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity(account("acc_1", true));
    await settle();
    expect(app.clients[0]?.calls).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["setPersonProperties", { $internal_or_test_user: true }],
      ["reloadFeatureFlags"],
    ]);
  });

  test("marks every account internal outside production", async () => {
    const app = setup({
      runtimeSettings: { ...settings, environment: "development" },
    });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    await settle();
    expect(app.clients[0]?.calls[1]).toEqual([
      "setPersonProperties",
      { $internal_or_test_user: true },
    ]);
  });

  test("resets before identifying another account and on sign-out", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    await settle();
    app.analytics.setIdentity(account("acc_2"));
    app.analytics.setIdentity({ kind: "anonymous" });
    expect(app.clients[0]?.calls).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
      ["reset"],
      ["identify", "workspace-account:acc_2"],
      ["reloadFeatureFlags"],
      ["reset"],
      ["reloadFeatureFlags"],
    ]);
  });

  test("resets a stored account identity before anonymous delivery", async () => {
    const app = setup({ restoredDistinctId: "workspace-account:acc_1" });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.analytics.capture({ name: "booking started" });
    await settle();
    expect(app.clients[0]?.calls).toEqual([
      ["reset"],
      ["reloadFeatureFlags"],
      ["capture", "booking started", undefined],
    ]);
  });

  test("resets a stored identity of another account before identifying", async () => {
    const app = setup({ restoredDistinctId: "workspace-account:acc_1" });
    app.connect();
    app.analytics.setIdentity(account("acc_2"));
    await settle();
    expect(app.clients[0]?.calls).toEqual([
      ["reset"],
      ["identify", "workspace-account:acc_2"],
      ["reloadFeatureFlags"],
    ]);
  });

  test("marks a stored matching account internal outside production", async () => {
    const app = setup({
      restoredDistinctId: "workspace-account:acc_1",
      runtimeSettings: { ...settings, environment: "preview" },
    });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    await settle();
    expect(app.clients[0]?.calls).toEqual([
      ["setPersonProperties", { $internal_or_test_user: true }],
    ]);
  });

  test("loads flags for a stored identity that already matches", async () => {
    const app = setup({ restoredDistinctId: "workspace-account:acc_1" });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    await settle();
    expect(app.clients[0]?.calls).toEqual([["reloadFeatureFlags"]]);
  });
});

describe("withdrawal", () => {
  test("shuts the client down, drops it and discards held events", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    const first = app.clients[0];
    app.analytics.setIdentity({ kind: "pending" });
    app.analytics.capture({ name: "booking started" });

    app.setConsent("denied");
    expect(first?.calls).toEqual([["reloadFeatureFlags"], ["shutDown"]]);
    expect(first?.flagListenerCount()).toBe(0);

    app.analytics.capture({ name: "booking submitted" });
    app.analytics.setIdentity({ kind: "anonymous" });
    first?.finishShutdown();
    await settle();
    expect(first?.calls).toEqual([["reloadFeatureFlags"], ["shutDown"]]);
    expect(app.clients).toHaveLength(1);
  });

  test("granting again builds a fresh client once shutdown finishes", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    await settle();
    app.setConsent("denied");
    app.setConsent("granted");
    expect(app.clients).toHaveLength(1);

    app.clients[0]?.finishShutdown();
    await settle();
    expect(app.clients).toHaveLength(2);
    expect(app.clients[1]?.calls).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
    ]);
  });

  test("disconnecting shuts the client down", async () => {
    const app = setup();
    const disconnect = app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    disconnect();
    expect(app.clients[0]?.calls.at(-1)).toEqual(["shutDown"]);
  });
});

describe("feature flags", () => {
  test("reads nothing without a client", () => {
    const app = setup({ consent: "denied" });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();
  });

  test("notifies when flags load and when the client goes away", async () => {
    const app = setup();
    let notifications = 0;
    app.analytics.subscribeFeatureFlags(() => notifications++);
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    const before = notifications;

    app.clients[0]?.finishFlagReload(0, { seating_map: true });
    await settle();
    expect(notifications).toBe(before + 2);
    expect(app.analytics.featureFlag("seating_map")).toBe(true);

    app.setConsent("denied");
    expect(notifications).toBe(before + 3);
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();
  });

  test("reads the fallback for a restored identity until its own flags load", async () => {
    // identify() persists the new ID before its flags arrive, so a restarted
    // client can restore the account's ID with the anonymous flags.
    const app = setup({
      restoredDistinctId: "workspace-account:acc_1",
      holdLoading: true,
    });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    app.clients[0]?.loadFlags({ seating_map: true });
    app.clients[0]?.finishLoading();
    await settle();
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();

    app.clients[0]?.finishFlagReload(0, { seating_map: "variant" });
    await settle();
    expect(app.analytics.featureFlag("seating_map")).toBe("variant");
  });

  test("reads the fallback after sign-in until the account's flags load", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    app.clients[0]?.finishFlagReload(0, { seating_map: true });
    await settle();
    expect(app.analytics.featureFlag("seating_map")).toBe(true);

    app.analytics.setIdentity(account("acc_1"));
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();

    // A response the SDK requested before the sign-in notifies too.
    app.clients[0]?.loadFlags({ seating_map: true });
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();

    let notified = false;
    app.analytics.subscribeFeatureFlags(() => {
      notified = true;
    });
    app.clients[0]?.finishFlagReload(1, { seating_map: "variant" });
    await settle();
    expect(notified).toBe(true);
    expect(app.analytics.featureFlag("seating_map")).toBe("variant");
  });

  test("reads the fallback after sign-out until the anonymous flags load", async () => {
    const app = setup({ restoredDistinctId: "workspace-account:acc_1" });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    await settle();
    app.clients[0]?.finishFlagReload(0, { seating_map: "variant" });
    await settle();
    expect(app.analytics.featureFlag("seating_map")).toBe("variant");

    app.analytics.setIdentity({ kind: "anonymous" });
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();
    app.clients[0]?.finishFlagReload(1, { seating_map: false });
    await settle();
    expect(app.analytics.featureFlag("seating_map")).toBe(false);
  });

  test("ignores a reload for an identity that changed again", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    app.analytics.setIdentity(account("acc_1"));
    app.analytics.setIdentity(account("acc_2"));

    app.clients[0]?.finishFlagReload(1, { seating_map: true });
    await settle();
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();

    app.clients[0]?.finishFlagReload(2, { seating_map: "acc_2" });
    await settle();
    expect(app.analytics.featureFlag("seating_map")).toBe("acc_2");
  });

  test("keeps the fallback when the new identity's flags fail to load", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    app.clients[0]?.finishFlagReload(0, { seating_map: true });
    app.analytics.setIdentity(account("acc_1"));
    app.clients[0]?.failFlagReload(1);
    await settle();
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();
    expect(app.warnings).toHaveLength(1);
  });

  test("reads nothing while the identity is pending", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    app.clients[0]?.loadFlags({ seating_map: true });
    app.analytics.setIdentity({ kind: "pending" });
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();
  });
});

describe("account consent hold", () => {
  test("starts no client for a held account until its check settles", async () => {
    const app = setup({ accountCheck: true });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    app.analytics.screen("/reservations");
    app.analytics.capture({ name: "access PIN viewed" });
    await settle();
    expect(app.clients).toHaveLength(0);
    expect(app.analytics.featureFlag("flag")).toBeUndefined();

    app.settleCheck("acc_1");
    await settle();
    expect(app.clients[0]?.calls).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
      ["screen", "/reservations"],
      ["capture", "access PIN viewed", undefined],
    ]);
  });

  test("discards what was held when the check withdraws, and clears stored state", async () => {
    const app = setup({ accountCheck: true });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    app.analytics.capture({ name: "sign-in completed", awaitsAccount: true });
    app.analytics.screen("/account");

    app.setConsent("denied");
    app.settleCheck("acc_1");
    await settle();

    expect(app.clients).toHaveLength(0);
    expect(app.storedStateClears()).toBe(1);
    app.setConsent("granted");
    await settle();
    expect(app.clients[0]?.calls).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
    ]);
  });

  test("pauses an identified client on a recheck and resumes on settle", async () => {
    const app = setup({ accountCheck: true });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    app.settleCheck("acc_1");
    await settle();
    const client = app.clients[0];
    client?.finishFlagReload(0, { flag: "on" });
    await settle();

    app.recheck();
    expect(client?.networkHeld()).toBe(true);
    app.analytics.capture({ name: "access PIN viewed" });
    app.analytics.screen("/account");
    // The paused client already belongs to the account: its flags stay.
    expect(app.analytics.featureFlag("flag")).toBe("on");
    expect(client?.calls.filter(([name]) => name === "capture")).toEqual([]);

    app.settleCheck("acc_1");
    expect(client?.networkHeld()).toBe(false);
    expect(client?.calls.slice(-3)).toEqual([
      ["holdNetwork", false],
      ["capture", "access PIN viewed", undefined],
      ["screen", "/account"],
    ]);
  });

  test("shuts a paused client down without sending what waited", async () => {
    const app = setup({ accountCheck: true });
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    app.settleCheck("acc_1");
    await settle();
    const client = app.clients[0];

    app.recheck();
    app.analytics.capture({ name: "access PIN viewed" });
    app.setConsent("denied");
    app.settleCheck("acc_1");
    client?.finishShutdown();
    await settle();

    expect(client?.calls).toEqual([
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
      ["holdNetwork", true],
      ["shutDown"],
    ]);
    expect(app.clients).toHaveLength(1);
  });

  test("holds an anonymous client's identify on sign-in until the check settles", async () => {
    const app = setup({ accountCheck: true });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    const client = app.clients[0];
    client?.finishFlagReload(0, { flag: "anonymous" });
    await settle();

    app.analytics.setIdentity(account("acc_1"));
    app.analytics.capture({ name: "sign-in completed", awaitsAccount: true });
    expect(client?.networkHeld()).toBe(true);
    expect(app.analytics.featureFlag("flag")).toBeUndefined();
    expect(client?.calls.some(([name]) => name === "identify")).toBe(false);

    app.settleCheck("acc_1");
    expect(client?.calls.slice(-4)).toEqual([
      ["holdNetwork", false],
      ["identify", "workspace-account:acc_1"],
      ["reloadFeatureFlags"],
      ["capture", "sign-in completed", undefined],
    ]);
  });

  test("never holds anonymous delivery", async () => {
    const app = setup({ accountCheck: true });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.analytics.capture({ name: "booking started" });
    await settle();
    expect(app.clients[0]?.calls).toEqual([
      ["reloadFeatureFlags"],
      ["capture", "booking started", undefined],
    ]);
  });

  test("a check of another account releases nothing", async () => {
    const app = setup({ accountCheck: true });
    app.connect();
    app.analytics.setIdentity(account("acc_2"));
    app.settleCheck("acc_1");
    await settle();
    expect(app.clients).toHaveLength(0);
  });
});

describe("stored state", () => {
  test("clears it once on a refusal while no client runs", async () => {
    const app = setup({ consent: "denied" });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.analytics.capture({ name: "booking started" });
    await settle();
    expect(app.storedStateClears()).toBe(1);
  });

  test("leaves an undecided device's storage alone", async () => {
    const app = setup({ consent: "undecided" });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    expect(app.storedStateClears()).toBe(0);
  });

  test("relies on shutdown to clear a running client's state", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    app.setConsent("denied");
    app.clients[0]?.finishShutdown();
    await settle();
    expect(app.storedStateClears()).toBe(0);
  });

  test("retries a failed clear before a later grant starts a client", async () => {
    const app = setup({
      consent: "denied",
      restoredDistinctId: "workspace-account:acc_old",
      failedStoredStateClears: 1,
    });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    expect(app.storedStateClears()).toBe(1);

    app.setConsent("granted");
    app.analytics.capture({ name: "booking started" });
    expect(app.clients).toHaveLength(0);

    await settle();
    expect(app.storedStateClears()).toBe(2);
    // Built only once the clear succeeded, so nothing of the old identity
    // remains to be reset or reused.
    expect(app.clients).toHaveLength(1);
    expect(app.clients[0]?.calls).toEqual([
      ["reloadFeatureFlags"],
      ["capture", "booking started", undefined],
    ]);
  });

  test("keeps analytics off for a grant while clearing keeps failing", async () => {
    const app = setup({
      consent: "denied",
      restoredDistinctId: "workspace-account:acc_old",
      failedStoredStateClears: 2,
    });
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();

    app.setConsent("granted");
    app.analytics.capture({ name: "booking started" });
    await settle();
    app.analytics.capture({ name: "booking submitted" });
    await settle();
    expect(app.storedStateClears()).toBe(2);
    expect(app.clients).toHaveLength(0);

    app.setConsent("denied");
    await settle();
    app.setConsent("granted");
    await settle();
    expect(app.storedStateClears()).toBe(3);
    expect(app.clients[0]?.calls).toEqual([["reloadFeatureFlags"]]);
  });

  test("clears it before a grant when the withdrawn client's shutdown fails", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity(account("acc_1"));
    await settle();
    app.setConsent("denied");
    app.setConsent("granted");

    app.clients[0]?.failShutdown();
    await settle();
    expect(app.storedStateClears()).toBe(1);
    expect(app.clients).toHaveLength(2);
  });
});
