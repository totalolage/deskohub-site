import { describe, expect, test } from "bun:test";
import type { AnalyticsConsentStatus } from "../consent/analytics-consent";
import { type AnalyticsRuntime, createAnalytics } from "./analytics";
import type {
  AnalyticsClient,
  AnalyticsClientOptions,
} from "./analytics-client";
import type { AnalyticsSettings } from "./analytics-settings";

type Call = readonly [string, ...unknown[]];

const createFakeClient = (
  options: AnalyticsClientOptions,
  restoredDistinctId: string | null
) => {
  const calls: Call[] = [];
  const flagListeners = new Set<() => void>();
  let flags: Record<string, boolean | string> | undefined;
  let finishShutdown: () => void = () => {};
  const client: AnalyticsClient = {
    identifiedAs: () => restoredDistinctId,
    capture: (event, properties) => calls.push(["capture", event, properties]),
    screen: (name) => calls.push(["screen", name]),
    identify: (distinctId) => calls.push(["identify", distinctId]),
    setPersonProperties: (properties) =>
      calls.push(["setPersonProperties", properties]),
    reset: () => calls.push(["reset"]),
    reloadFeatureFlags: () => calls.push(["reloadFeatureFlags"]),
    getFeatureFlag: (flag) => flags?.[flag],
    onFeatureFlags: (listener) => {
      flagListeners.add(listener);
      return () => flagListeners.delete(listener);
    },
    shutDown: () => {
      calls.push(["shutDown"]);
      return new Promise<void>((resolve) => {
        finishShutdown = resolve;
      });
    },
  };
  return {
    client,
    options,
    calls,
    loadFlags: (next: Record<string, boolean | string>) => {
      flags = next;
      for (const listener of flagListeners) listener();
    },
    finishShutdown: () => finishShutdown(),
    flagListenerCount: () => flagListeners.size,
  };
};

type FakeClient = ReturnType<typeof createFakeClient>;

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
}: {
  readonly consent?: AnalyticsConsentStatus;
  readonly runtimeSettings?: AnalyticsSettings | null;
  readonly otherSdk?: boolean;
  /** The identity the SDK's stored state already holds. */
  readonly restoredDistinctId?: string | null;
} = {}) => {
  const analytics = createAnalytics();
  const clients: FakeClient[] = [];
  const warnings: string[] = [];
  let status = consent;
  const consentListeners = new Set<() => void>();
  const runtime: AnalyticsRuntime = {
    settings: runtimeSettings,
    createClient: (options) => {
      const fake = createFakeClient(options, restoredDistinctId);
      clients.push(fake);
      return Promise.resolve(fake.client);
    },
    detectOtherSdk: () => otherSdk,
    consent: {
      status: () => status,
      subscribe: (listener) => {
        consentListeners.add(listener);
        return () => consentListeners.delete(listener);
      },
    },
    warn: (message) => warnings.push(message),
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
      superProperties: { "deployment.environment.name": "preview" },
    });
  });

  test("loads flags for an anonymous identity", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    await settle();
    expect(app.clients[0]?.calls).toEqual([["reloadFeatureFlags"]]);
  });

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

  test("drops a client that finishes starting after withdrawal", async () => {
    const app = setup();
    app.connect();
    app.analytics.setIdentity({ kind: "anonymous" });
    app.setConsent("denied");
    await settle();
    expect(app.clients[0]?.calls).toEqual([["shutDown"]]);
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
      ["reset"],
      ["identify", "workspace-account:acc_2"],
      ["reset"],
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

    app.clients[0]?.loadFlags({ seating_map: true });
    expect(notifications).toBe(before + 1);
    expect(app.analytics.featureFlag("seating_map")).toBe(true);

    app.setConsent("denied");
    expect(notifications).toBe(before + 2);
    expect(app.analytics.featureFlag("seating_map")).toBeUndefined();
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
