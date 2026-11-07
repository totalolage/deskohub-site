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
  restoredDistinctId: string | null,
  holdLoading: boolean
) => {
  const calls: Call[] = [];
  const flagListeners = new Set<() => void>();
  let flags: Record<string, boolean | string> | undefined;
  let finishShutdown: () => void = () => {};
  let finishLoading: () => void = () => {};
  let failLoading: () => void = () => {};
  const flagReloads: {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }[] = [];
  const loading = new Promise<void>((resolve, reject) => {
    finishLoading = resolve;
    failLoading = () => reject(new Error("storage"));
  });
  if (!holdLoading) finishLoading();
  const client: AnalyticsClient = {
    ready: () => loading,
    identifiedAs: () => restoredDistinctId,
    capture: (event, properties) => calls.push(["capture", event, properties]),
    screen: (name) => calls.push(["screen", name]),
    identify: (distinctId) => calls.push(["identify", distinctId]),
    setPersonProperties: (properties) =>
      calls.push(["setPersonProperties", properties]),
    reset: () => calls.push(["reset"]),
    reloadFeatureFlags: () => {
      calls.push(["reloadFeatureFlags"]);
      return new Promise<void>((resolve, reject) => {
        flagReloads.push({ resolve, reject });
      });
    },
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
    /** The SDK stores flag values and notifies, as any flags response does. */
    loadFlags: (next: Record<string, boolean | string>) => {
      flags = next;
      for (const listener of flagListeners) listener();
    },
    /** Settles the `index`th reload the controller asked for. */
    finishFlagReload: (
      index: number,
      next: Record<string, boolean | string>
    ) => {
      flags = next;
      for (const listener of flagListeners) listener();
      flagReloads[index]?.resolve();
    },
    failFlagReload: (index: number) =>
      flagReloads[index]?.reject(new Error("flags")),
    finishShutdown: () => finishShutdown(),
    finishLoading: () => finishLoading(),
    failLoading: () => failLoading(),
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
  holdLoading = false,
}: {
  readonly consent?: AnalyticsConsentStatus;
  readonly runtimeSettings?: AnalyticsSettings | null;
  readonly otherSdk?: boolean;
  /** The identity the SDK's stored state already holds. */
  readonly restoredDistinctId?: string | null;
  /** Keeps each client loading until the test finishes it. */
  readonly holdLoading?: boolean;
} = {}) => {
  const analytics = createAnalytics();
  const clients: FakeClient[] = [];
  const warnings: string[] = [];
  let status = consent;
  const consentListeners = new Set<() => void>();
  const runtime: AnalyticsRuntime = {
    settings: runtimeSettings,
    createClient: (options) => {
      const fake = createFakeClient(options, restoredDistinctId, holdLoading);
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
      ["reloadFeatureFlags"],
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
