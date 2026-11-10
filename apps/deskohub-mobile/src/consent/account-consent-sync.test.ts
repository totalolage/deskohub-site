import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { createAnalytics } from "../analytics/analytics";
import {
  type FakeAnalyticsClient,
  makeFakeAnalyticsClient,
} from "../analytics/testing/fake-analytics-client";
import type { CustomerDataServices } from "../customer-api/customer-data-runtime";
import { makeCustomerDataRegistry } from "../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../customer-api/testing/fake-customer-data";
import {
  type FakeAnalyticsDecision,
  FakeWorkspace,
} from "../customer-api/testing/fake-workspace";
import { makeAppForegroundAtom } from "../platform/app-foreground";
import { fakeAppState } from "../platform/testing/fake-app-state";
import {
  followAccountConsent,
  syncAccountAnalyticsConsent,
  syncAccountAnalyticsConsentAtom,
} from "./account-consent-sync";
import type { StoredConsent } from "./analytics-consent";
import { makeFakeDeviceConsent } from "./testing/fake-device-consent";

const deviceGrant: StoredConsent = {
  kind: "decided",
  categories: ["necessary", "analytics", "marketing"],
  decidedAt: "2026-11-01T08:00:00.123Z",
  locale: "cs-CZ",
};
const laterWithdrawal: FakeAnalyticsDecision = {
  granted: false,
  decidedAt: "2026-11-05T09:30:15.250Z",
  notice: "current",
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A signed-in device over the fake Workspace: its stored consent (read at
 * once, or once `load` is called), the account's decision, and the check.
 */
const setup = ({
  stored,
  decision,
  loadLater = false,
}: {
  readonly stored: StoredConsent;
  readonly decision?: FakeAnalyticsDecision;
  readonly loadLater?: boolean;
}) => {
  const workspace = FakeWorkspace.forKind("linked");
  workspace.analyticsDecision = decision;
  const accountId = workspace.data.accountId;
  const { consent, check, writes, load, ...device } = makeFakeDeviceConsent({
    stored,
    accountId,
    loadLater,
  });
  const layer: Layer.Layer<CustomerDataServices> = Layer.mergeAll(
    fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
    device.layer
  );
  const registry = makeCustomerDataRegistry(layer);
  const appState = fakeAppState();
  const request = { accountId, locale: "en-US" } as const;
  return {
    workspace,
    accountId,
    consent,
    check,
    writes,
    appState,
    load,
    /** Runs one sync to its end, outside any follower. */
    syncOnce: () =>
      Effect.runPromise(
        syncAccountAnalyticsConsent(request).pipe(Effect.provide(layer))
      ),
    /** Follows the account as the account screens do. */
    follow: () =>
      followAccountConsent({
        registry,
        foreground: makeAppForegroundAtom(appState.source),
        consent,
        check,
        request,
      }),
    /** Waits until the follower's latest sync has finished. */
    synced: async () => {
      await flush();
      await Effect.runPromise(
        Effect.result(
          AtomRegistry.getResult(syncAccountAnalyticsConsentAtom, {
            suspendOnWaiting: true,
          })(registry)
        )
      );
      await flush();
    },
  };
};

describe("syncAccountAnalyticsConsent", () => {
  test("sends the stored choice with its decision time and language", async () => {
    const device = setup({ stored: deviceGrant });

    await device.syncOnce();

    expect(device.workspace.analyticsSyncs).toEqual([
      {
        choice: { analytics: true, decidedAt: "2026-11-01T08:00:00.123Z" },
        locale: "cs-CZ",
      },
    ]);
    expect(device.check.holds(device.accountId)).toBe(false);
    expect(device.check.firstCheckPending(device.accountId)).toBe(false);
  });

  test("sends a choice stored in a language added after Czech and English in that language", async () => {
    const device = setup({
      stored: {
        kind: "decided",
        categories: ["necessary", "analytics"],
        decidedAt: "2026-11-01T08:00:00.123Z",
        locale: "uk-UA",
      },
    });

    await device.syncOnce();

    expect(device.workspace.analyticsSyncs.map(({ locale }) => locale)).toEqual(
      ["uk-UA"]
    );
  });

  test("sends the app's language for a choice stored without one", async () => {
    const { locale: _locale, ...withoutLocale } = deviceGrant as Extract<
      StoredConsent,
      { kind: "decided" }
    >;
    const device = setup({ stored: withoutLocale });

    await device.syncOnce();

    expect(device.workspace.analyticsSyncs[0]?.locale).toBe("en-US");
  });

  test("takes the account's later withdrawal, dated when it was made", async () => {
    const device = setup({ stored: deviceGrant, decision: laterWithdrawal });

    await device.syncOnce();

    expect(device.consent.status()).toBe("denied");
    expect(device.writes).toEqual([
      {
        categories: ["necessary", "marketing"],
        decidedAt: "2026-11-05T09:30:15.250Z",
        locale: "en-US",
      },
    ]);
    expect(device.check.holds(device.accountId)).toBe(false);
  });

  test("sends a taken decision back unchanged, so the account records nothing", async () => {
    const device = setup({ stored: deviceGrant, decision: laterWithdrawal });
    await device.syncOnce();

    await device.syncOnce();

    expect(device.workspace.analyticsSyncs[1]?.choice).toEqual({
      analytics: false,
      decidedAt: "2026-11-05T09:30:15.250Z",
    });
    expect(device.workspace.analyticsDecision).toEqual(laterWithdrawal);
    expect(device.writes).toHaveLength(1);
  });

  test("takes the account's current-notice grant without a choice of its own", async () => {
    const grant: FakeAnalyticsDecision = {
      granted: true,
      decidedAt: "2026-11-05T09:30:15.250Z",
      notice: "current",
    };
    const device = setup({ stored: { kind: "undecided" }, decision: grant });
    expect(device.check.firstCheckPending(device.accountId)).toBe(true);

    await device.syncOnce();

    expect(device.workspace.analyticsSyncs).toEqual([
      { choice: null, locale: "en-US" },
    ]);
    expect(device.consent.current()).toEqual({
      kind: "decided",
      categories: ["necessary", "analytics"],
      decidedAt: "2026-11-05T09:30:15.250Z",
      locale: "en-US",
    });
    expect(device.check.firstCheckPending(device.accountId)).toBe(false);
    expect(device.check.holds(device.accountId)).toBe(false);
  });

  test("keeps asking without a choice when the account's grant predates the notice or it withdrew", async () => {
    for (const decision of [
      { ...laterWithdrawal, granted: true, notice: "earlier" },
      laterWithdrawal,
    ] as const) {
      const device = setup({ stored: { kind: "undecided" }, decision });

      await device.syncOnce();

      expect(device.consent.status()).toBe("undecided");
      expect(device.writes).toEqual([]);
      expect(device.check.firstCheckPending(device.accountId)).toBe(false);
    }
  });

  test("never takes the account's grant over a choice the device holds", async () => {
    const device = setup({
      stored: { ...deviceGrant, categories: ["necessary"] },
      decision: { ...laterWithdrawal, granted: true },
    });

    await device.syncOnce();

    expect(device.consent.status()).toBe("denied");
    expect(device.writes).toEqual([]);
  });

  test("discards the answer when the device's choice changed meanwhile", async () => {
    const device = setup({ stored: deviceGrant, decision: laterWithdrawal });
    device.workspace.onAnalyticsConsentRequest = () => device.consent.deny();

    await device.syncOnce();

    expect(device.consent.current()).toMatchObject({
      categories: ["necessary", "marketing"],
      decidedAt: "2026-11-10T12:00:00.000Z",
    });
    expect(device.writes).toHaveLength(1);
  });

  test("discards the answer when another account signed in meanwhile", async () => {
    const device = setup({ stored: deviceGrant, decision: laterWithdrawal });
    device.workspace.onAnalyticsConsentRequest = () =>
      device.check.follow("another-account");

    await device.syncOnce();

    expect(device.consent.status()).toBe("granted");
    expect(device.writes).toEqual([]);
    expect(device.check.holds("another-account")).toBe(true);
  });

  test("leaves the device unchanged when the sync fails, and releases the hold", async () => {
    for (const outcome of [
      "service-unavailable",
      "transport-failure",
      "session-required",
    ] as const) {
      const device = setup({ stored: deviceGrant, decision: laterWithdrawal });
      device.workspace.fail("syncAnalyticsConsent", outcome);

      await device.syncOnce();

      expect(device.consent.status()).toBe("granted");
      expect(device.writes).toEqual([]);
      expect(device.check.holds(device.accountId)).toBe(false);
    }
  });

  test("sends nothing for a refusal without a decision time", async () => {
    const device = setup({ stored: { kind: "decided", categories: [] } });

    await device.syncOnce();

    expect(device.workspace.analyticsSyncs).toEqual([]);
    expect(device.check.holds(device.accountId)).toBe(false);
  });
});

describe("followAccountConsent", () => {
  test("syncs on start, after the customer's answer and on each return to the foreground", async () => {
    const device = setup({ stored: { kind: "undecided" } });
    const stop = device.follow();
    await device.synced();
    expect(device.workspace.analyticsSyncs).toEqual([
      { choice: null, locale: "en-US" },
    ]);

    device.consent.grant();
    await device.synced();
    expect(device.workspace.analyticsSyncs[1]).toEqual({
      choice: { analytics: true, decidedAt: "2026-11-10T12:00:00.000Z" },
      locale: "en-US",
    });

    device.appState.change("background");
    await device.synced();
    expect(device.workspace.analyticsSyncs).toHaveLength(2);
    expect(device.check.holds(device.accountId)).toBe(false);

    device.appState.change("active");
    // Held from the AppState event itself, before the sync answers.
    expect(device.check.holds(device.accountId)).toBe(true);
    await device.synced();
    expect(device.workspace.analyticsSyncs).toHaveLength(3);
    expect(device.check.holds(device.accountId)).toBe(false);

    stop();
    device.appState.change("background");
    device.appState.change("active");
    await flush();
    expect(device.workspace.analyticsSyncs).toHaveLength(3);
  });

  test("takes a withdrawal made elsewhere on the next return to the foreground", async () => {
    const device = setup({ stored: deviceGrant });
    const stop = device.follow();
    await device.synced();
    expect(device.consent.status()).toBe("granted");

    device.workspace.analyticsDecision = {
      ...laterWithdrawal,
      decidedAt: "2026-11-10T11:00:00.000Z",
    };
    device.appState.change("background");
    device.appState.change("active");
    await device.synced();

    expect(device.consent.status()).toBe("denied");
    expect(device.consent.current()).toMatchObject({
      decidedAt: "2026-11-10T11:00:00.000Z",
    });
    // Taking the account's decision isn't a choice to send back.
    expect(device.workspace.analyticsSyncs).toHaveLength(2);
    stop();
  });

  test("waits for the stored answer before it sends or releases", async () => {
    const device = setup({ stored: deviceGrant, loadLater: true });
    const stop = device.follow();
    await device.synced();
    expect(device.workspace.analyticsSyncs).toEqual([]);
    expect(device.check.holds(device.accountId)).toBe(true);

    device.load();
    await device.synced();

    expect(device.workspace.analyticsSyncs).toHaveLength(1);
    expect(device.check.holds(device.accountId)).toBe(false);
    stop();
  });
});

/**
 * The analytics controller over the device's consent and check, connected
 * before or after the account sync starts following, so either consent
 * subscriber hears a new choice first.
 */
const withAnalytics = (
  device: ReturnType<typeof setup>,
  order: "analytics first" | "sync first"
) => {
  const analytics = createAnalytics();
  const clients: FakeAnalyticsClient[] = [];
  const connect = () =>
    analytics.connect({
      settings: {
        apiKey: "phc_test",
        host: "https://t.example.test",
        environment: "production",
      },
      createClient: (options) => {
        const fake = makeFakeAnalyticsClient(options);
        clients.push(fake);
        return fake.client;
      },
      detectOtherSdk: () => false,
      consent: device.consent,
      accountCheck: device.check,
      clearStoredState: async () => {},
      warn: () => {},
    });
  const stops =
    order === "analytics first"
      ? [connect(), device.follow()]
      : [device.follow(), connect()];
  analytics.setIdentity({
    kind: "authenticated",
    accountId: device.accountId,
    testAccount: false,
  });
  return {
    analytics,
    clients,
    /** Every identity any client applied. */
    identified: () =>
      clients.flatMap(({ calls }) =>
        calls.filter(([name]) => name === "identify")
      ),
    stop: () => {
      for (const stop of stops) stop();
    },
  };
};

/** Lets pending requests and their callbacks run. */
const until = async (reached: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !reached(); attempt++) await flush();
  expect(reached()).toBe(true);
};

describe("followAccountConsent with analytics", () => {
  // Made on the site after the fake device's clock (`fakeDeviceNow`).
  const withdrawnAfterDeviceClock: FakeAnalyticsDecision = {
    granted: false,
    decidedAt: "2026-11-10T13:00:00.000Z",
    notice: "current",
  };

  /** Settles the session's first check, then delays the next sync's answer. */
  const answeredPrompt = async (
    decision: FakeAnalyticsDecision | undefined,
    order: "analytics first" | "sync first"
  ) => {
    const device = setup({ stored: { kind: "undecided" }, decision });
    const app = withAnalytics(device, order);
    await device.synced();
    expect(device.check.firstCheckPending(device.accountId)).toBe(false);
    let answer = () => {};
    device.workspace.analyticsSyncDelay = new Promise((resolve) => {
      answer = resolve;
    });

    device.consent.grant();
    await until(() => device.workspace.analyticsSyncs.length === 2);
    app.analytics.capture({ name: "booking started" });
    await flush();
    return { device, app, answer };
  };

  for (const order of ["analytics first", "sync first"] as const) {
    test(`starts no client for the prompt's answer until its sync answers (${order})`, async () => {
      const { device, app, answer } = await answeredPrompt(
        withdrawnAfterDeviceClock,
        order
      );
      expect(device.consent.status()).toBe("granted");
      expect(app.identified()).toEqual([]);
      expect(app.clients).toHaveLength(0);

      answer();
      await device.synced();

      // The account's later withdrawal outranks the older grant.
      expect(device.consent.status()).toBe("denied");
      expect(app.identified()).toEqual([]);
      expect(app.clients).toHaveLength(0);
      app.stop();
    });
  }

  test("delivers what waited once the account takes the answer", async () => {
    const { device, app, answer } = await answeredPrompt(
      undefined,
      "analytics first"
    );
    expect(app.clients).toHaveLength(0);

    answer();
    await device.synced();
    await flush();

    expect(device.consent.status()).toBe("granted");
    expect(app.clients[0]?.calls).toEqual([
      ["identify", `workspace-account:${device.accountId}`],
      ["reloadFeatureFlags"],
      ["capture", "booking started", undefined],
    ]);
    app.stop();
  });

  test("releases the answer when its sync fails", async () => {
    const device = setup({ stored: { kind: "undecided" } });
    const app = withAnalytics(device, "analytics first");
    await device.synced();
    device.workspace.fail("syncAnalyticsConsent", "service-unavailable");

    device.consent.grant();
    await device.synced();
    await flush();

    expect(device.consent.status()).toBe("granted");
    expect(app.clients[0]?.calls[0]).toEqual([
      "identify",
      `workspace-account:${device.accountId}`,
    ]);
    app.stop();
  });
});
