import { describe, expect, test } from "bun:test";
import { Cause, Effect, Layer } from "effect";
import {
  AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import type { StoredConsent } from "../../consent/analytics-consent";
import { makeFakeDeviceConsent } from "../../consent/testing/fake-device-consent";
import { CustomerWriteUnconfirmed } from "../../customer-api/customer-request";
import {
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import {
  makeCustomerDataRegistry,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { type AppLocale, appLocales } from "../../i18n/app-locale";
import { makeAppForegroundAtom } from "../../platform/app-foreground";
import { fakeAppState } from "../../platform/testing/fake-app-state";
import {
  analyticsPreferenceAtom,
  analyticsSwitchView,
  followAnalyticsPreference,
  isAnalyticsPreferenceUnavailable,
  saveAnalyticsPreferenceAtom,
} from "./analytics-preference";

const deviceGrant: StoredConsent = {
  kind: "decided",
  categories: ["necessary", "analytics", "marketing"],
  decidedAt: "2026-11-01T08:00:00.123Z",
  locale: "cs-CZ",
};

const run = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );

/** The Legal screen over the fake Workspace, on a device holding `stored`. */
const openScreen = async ({
  stored = deviceGrant,
  granted,
}: {
  readonly stored?: StoredConsent;
  readonly granted?: boolean;
} = {}) => {
  const workspace = FakeWorkspace.forKind("linked");
  if (granted !== undefined) {
    workspace.analyticsDecision = {
      granted,
      decidedAt: "2026-10-01T08:00:00.000Z",
      notice: "current",
    };
  }
  const device = makeFakeDeviceConsent({
    stored,
    accountId: workspace.data.accountId,
  });
  const registry = makeCustomerDataRegistry(
    Layer.mergeAll(
      fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
      device.layer
    )
  );
  const unmountPreference = registry.mount(analyticsPreferenceAtom);
  const unmountSave = registry.mount(saveAnalyticsPreferenceAtom);
  const preference = await run(registry, analyticsPreferenceAtom);
  return {
    workspace,
    device,
    registry,
    preference,
    save: async (choice: boolean, locale: AppLocale = "cs-CZ") => {
      registry.set(saveAnalyticsPreferenceAtom, { granted: choice, locale });
      const outcome = await run(registry, saveAnalyticsPreferenceAtom);
      return {
        outcome,
        preference: await run(registry, analyticsPreferenceAtom),
      };
    },
    close: () => {
      unmountSave();
      unmountPreference();
    },
  };
};

describe("analyticsPreferenceAtom", () => {
  test.each([true, false])(
    "reads the account's preference %p",
    async (granted) => {
      const screen = await openScreen({ granted });
      expect(screen.preference).toMatchObject({
        _tag: "Success",
        success: { granted },
      });
      expect(screen.workspace.calls).toEqual(["getAnalyticsPreference"]);
      screen.close();
    }
  );

  test("reads as unavailable, not off, when the Workspace can't read it", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    workspace.fail("getAnalyticsPreference", "service-unavailable");
    const registry = makeCustomerDataRegistry(
      fakeCustomerDataLayer({ workspace, device: makeFakeDevice() })
    );

    const result = await settle(registry, analyticsPreferenceAtom);

    if (result._tag !== "Failure") throw new Error("expected a failure");
    expect(
      isAnalyticsPreferenceUnavailable(toCustomerViewError(result.failure))
    ).toBe(true);
  });

  test("leaves other failures to the shared wording", () => {
    expect(
      isAnalyticsPreferenceUnavailable(CustomerViewError.RateLimited())
    ).toBe(false);
  });
});

// A withdrawal made on the site while the app was in the background reaches
// this device at its next foreground; the Legal screen then shows it too,
// instead of the preference it read before.
describe("followAnalyticsPreference", () => {
  test("reads the account's preference again on each return to the foreground", async () => {
    const screen = await openScreen({ granted: true });
    const appState = fakeAppState();
    const stop = followAnalyticsPreference({
      registry: screen.registry,
      foreground: makeAppForegroundAtom(appState.source),
    });

    screen.workspace.analyticsDecision = {
      granted: false,
      decidedAt: "2026-11-10T10:35:13.487Z",
      notice: "current",
    };
    appState.change("background");
    expect(screen.workspace.calls).toEqual(["getAnalyticsPreference"]);
    appState.change("active");

    expect(await run(screen.registry, analyticsPreferenceAtom)).toMatchObject({
      _tag: "Success",
      success: { granted: false },
    });
    expect(screen.workspace.calls).toEqual([
      "getAnalyticsPreference",
      "getAnalyticsPreference",
    ]);

    stop();
    appState.change("background");
    appState.change("active");
    await run(screen.registry, analyticsPreferenceAtom);
    expect(screen.workspace.calls).toHaveLength(2);
    screen.close();
  });
});

describe("saveAnalyticsPreferenceAtom", () => {
  test("turns analytics off for the account and on this device, dated at the account's decision", async () => {
    const screen = await openScreen({ granted: true });

    const { outcome, preference } = await screen.save(false);

    expect(outcome._tag).toBe("Success");
    expect(preference).toMatchObject({ success: { granted: false } });
    const decision = screen.workspace.analyticsDecision;
    expect(decision?.granted).toBe(false);
    expect(screen.device.consent.status()).toBe("denied");
    expect(screen.device.writes).toEqual([
      {
        categories: ["necessary", "marketing"],
        decidedAt: decision?.decidedAt ?? "",
        locale: "en-US",
      },
    ]);
    screen.close();
  });

  test("saves in each language the app is translated into", async () => {
    const screen = await openScreen({ granted: true });

    for (const locale of appLocales) {
      const { outcome } = await screen.save(false, locale);
      expect(outcome._tag).toBe("Success");
    }

    expect(
      screen.workspace.analyticsPreferenceSaves.map(({ locale }) => locale)
    ).toEqual([...appLocales]);
    screen.close();
  });

  test("turns analytics on for this device too, keeping its other choices", async () => {
    const screen = await openScreen({
      stored: { ...deviceGrant, categories: ["necessary", "preferences"] },
      granted: false,
    });

    await screen.save(true);

    expect(screen.device.consent.current()).toMatchObject({
      categories: ["necessary", "preferences", "analytics"],
      decidedAt: screen.workspace.analyticsDecision?.decidedAt,
    });
    // The account's own decision needs no further sync before analytics runs.
    expect(screen.device.check.holds(screen.workspace.data.accountId)).toBe(
      false
    );
    screen.close();
  });

  test("leaves a choice made on this device meanwhile", async () => {
    const screen = await openScreen({ granted: true });
    screen.workspace.onAnalyticsConsentRequest = () =>
      screen.device.consent.grant();
    await screen.device.consent.applyAccountDecision({
      analytics: false,
      decidedAt: "2026-11-09T08:00:00.000Z",
    });
    const before = screen.device.writes.length;

    await screen.save(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.device.consent.status()).toBe("granted");
    expect(screen.device.writes.slice(before)).toEqual([
      {
        categories: ["necessary", "marketing", "analytics"],
        decidedAt: "2026-11-10T12:00:00.000Z",
        locale: "en-US",
      },
    ]);
    screen.close();
  });

  test("leaves this device when another account signed in meanwhile", async () => {
    const screen = await openScreen({ granted: true });
    screen.workspace.onAnalyticsConsentRequest = () =>
      screen.device.check.follow("another-account");

    await screen.save(false);

    expect(screen.device.consent.status()).toBe("granted");
    expect(screen.device.writes).toEqual([]);
    screen.close();
  });

  test("leaves this device and reads the preference again when the save may have applied", async () => {
    const screen = await openScreen({ granted: true });
    screen.workspace.fail("saveAnalyticsPreference", "transport-failure");

    const { outcome } = await screen.save(false);

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerWriteUnconfirmed" },
    });
    expect(screen.device.consent.status()).toBe("granted");
    expect(screen.workspace.calls.at(-1)).toBe("getAnalyticsPreference");
    screen.close();
  });
});

describe("analyticsSwitchView", () => {
  const preference = AsyncResult.success({ granted: true });

  test("takes no input and shows the choice while saving", () => {
    expect(
      analyticsSwitchView({
        preference,
        save: AsyncResult.waiting(AsyncResult.initial()),
        requested: false,
      })
    ).toEqual({ granted: false, enabled: false, feedback: { kind: "saving" } });
  });

  test("reports an unconfirmed save", () => {
    expect(
      analyticsSwitchView({
        preference,
        save: AsyncResult.failure(Cause.fail(new CustomerWriteUnconfirmed({}))),
        requested: false,
      }).feedback
    ).toEqual({ kind: "unconfirmed" });
  });

  test("keeps the saved status while a read shows the saved value", () => {
    expect(
      analyticsSwitchView({
        preference: AsyncResult.success({ granted: false }),
        save: AsyncResult.success(undefined),
        requested: false,
      })
    ).toEqual({ granted: false, enabled: true, feedback: { kind: "saved" } });
  });

  test("drops the saved status once a later read shows another value", () => {
    expect(
      analyticsSwitchView({
        preference: AsyncResult.success({ granted: false }),
        save: AsyncResult.success(undefined),
        requested: true,
      })
    ).toEqual({ granted: false, enabled: true, feedback: undefined });
  });

  test("keeps a failed save's feedback whatever a later read shows", () => {
    expect(
      analyticsSwitchView({
        preference: AsyncResult.success({ granted: true }),
        save: AsyncResult.failure(Cause.fail(new CustomerWriteUnconfirmed({}))),
        requested: true,
      }).feedback
    ).toEqual({ kind: "unconfirmed" });
  });

  test("takes no input without a current read", () => {
    expect(
      analyticsSwitchView({
        preference: AsyncResult.failure(Cause.fail("unavailable")),
        save: AsyncResult.initial(),
        requested: undefined,
      })
    ).toEqual({ granted: false, enabled: false, feedback: undefined });
  });
});
