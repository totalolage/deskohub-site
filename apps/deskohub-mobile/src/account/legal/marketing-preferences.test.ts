import { describe, expect, test } from "bun:test";
import { CustomerMarketingPreferencesRejected } from "@deskohub/workspace-customer-api";
import { Cause, Effect, Option } from "effect";
import {
  AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { CustomerWriteUnconfirmed } from "../../customer-api/customer-request";
import {
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  isMarketingPreferenceUnavailable,
  type MarketingPreferenceChoice,
  marketingPreferencesAtom,
  marketingSwitchView,
  saveMarketingPreferenceAtom,
} from "./marketing-preferences";

const run = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );

// Mounts the preferences as the screen does, so a save's refresh reaches it.
const openScreen = async (data: ReturnType<typeof makeFakeCustomerData>) => {
  const unmountPreferences = data.registry.mount(marketingPreferencesAtom);
  const unmountSave = data.registry.mount(saveMarketingPreferenceAtom);
  const preferences = await run(data.registry, marketingPreferencesAtom);
  return {
    preferences,
    close: () => {
      unmountSave();
      unmountPreferences();
    },
  };
};

const save = async (
  data: ReturnType<typeof makeFakeCustomerData>,
  choice: Omit<MarketingPreferenceChoice, "locale">
) => {
  data.registry.set(saveMarketingPreferenceAtom, {
    ...choice,
    locale: "cs-CZ",
  });
  const outcome = await run(data.registry, saveMarketingPreferenceAtom);
  const preferences = await run(data.registry, marketingPreferencesAtom);
  return { outcome, preferences };
};

describe("marketingPreferencesAtom", () => {
  test.each(["absent", "active", "withdrawn"] as const)(
    "reads a linked account's %s consent",
    async (status) => {
      const data = makeFakeCustomerData("linked");
      data.workspace.data = {
        ...data.workspace.data,
        marketing: { status, context: "sample-context" },
      };

      const result = await settle(data.registry, marketingPreferencesAtom);

      expect(result).toMatchObject({
        _tag: "Success",
        success: { status, context: "sample-context" },
      });
      expect(data.workspace.calls).toEqual(["getMarketingPreferences"]);
    }
  );

  test("answers an account without a usable profile with link-required", async () => {
    const data = makeFakeCustomerData("completion-required");

    const result = await settle(data.registry, marketingPreferencesAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountLinkRequired",
        reason: "profile-missing",
      },
    });
  });
});

describe("isMarketingPreferenceUnavailable", () => {
  test("answers guidance when the Workspace can't read the preference", async () => {
    const data = makeFakeCustomerData("linked");
    data.workspace.fail("getMarketingPreferences", "service-unavailable");

    const result = await settle(data.registry, marketingPreferencesAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerServiceUnavailable" },
    });
    if (result._tag !== "Failure") throw new Error("expected a failure");
    expect(
      isMarketingPreferenceUnavailable(toCustomerViewError(result.failure))
    ).toBe(true);
  });

  test("leaves other failures to the shared wording", () => {
    expect(
      isMarketingPreferenceUnavailable(CustomerViewError.RateLimited())
    ).toBe(false);
    expect(
      isMarketingPreferenceUnavailable(
        CustomerViewError.LinkRequired({ reason: "profile-missing" })
      )
    ).toBe(false);
    expect(isMarketingPreferenceUnavailable(CustomerViewError.TimedOut())).toBe(
      false
    );
  });
});

describe("saveMarketingPreferenceAtom", () => {
  test("saves the choice with the shown context, then reads the saved state", async () => {
    const data = makeFakeCustomerData("linked");
    const screen = await openScreen(data);
    const context = data.workspace.data.marketing.context;

    const { outcome, preferences } = await save(data, {
      context,
      granted: true,
    });
    screen.close();

    expect(outcome._tag).toBe("Success");
    expect(preferences).toMatchObject({
      success: { status: "active", context: `${context}+` },
    });
    expect(data.workspace.calls).toEqual([
      "getMarketingPreferences",
      "saveMarketingPreferences",
      "getMarketingPreferences",
    ]);
  });

  test("withdraws consent", async () => {
    const data = makeFakeCustomerData("linked");
    data.workspace.data = {
      ...data.workspace.data,
      marketing: { status: "active", context: "sample-context" },
    };
    const screen = await openScreen(data);

    const { preferences } = await save(data, {
      context: "sample-context",
      granted: false,
    });
    screen.close();

    expect(preferences).toMatchObject({ success: { status: "withdrawn" } });
  });

  test("reads the current state again when the shown one was stale", async () => {
    const data = makeFakeCustomerData("linked");
    const screen = await openScreen(data);
    // Another device saved meanwhile.
    data.workspace.data = {
      ...data.workspace.data,
      marketing: { status: "withdrawn", context: "newer-context" },
    };

    const { outcome, preferences } = await save(data, {
      context: "sample-context-outdated",
      granted: true,
    });
    screen.close();

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerMarketingPreferencesRejected",
        reason: "stale-context",
      },
    });
    expect(preferences).toMatchObject({
      success: { status: "withdrawn", context: "newer-context" },
    });
    expect(data.workspace.calls).toEqual([
      "getMarketingPreferences",
      "saveMarketingPreferences",
      "getMarketingPreferences",
    ]);
  });

  test("reads the state again when the save may have applied", async () => {
    const data = makeFakeCustomerData("linked");
    const screen = await openScreen(data);
    data.workspace.fail("saveMarketingPreferences", "transport-failure");

    const { outcome, preferences } = await save(data, {
      context: data.workspace.data.marketing.context,
      granted: true,
    });
    screen.close();

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerWriteUnconfirmed" },
    });
    expect(preferences).toMatchObject({ success: { status: "active" } });
    expect(data.workspace.calls).toEqual([
      "getMarketingPreferences",
      "saveMarketingPreferences",
      "getMarketingPreferences",
    ]);
  });

  test("keeps the saved choice when the read after the save fails", async () => {
    const data = makeFakeCustomerData("linked");
    const screen = await openScreen(data);
    data.workspace.fail("getMarketingPreferences", "service-unavailable");

    const { outcome } = await save(data, {
      context: data.workspace.data.marketing.context,
      granted: true,
    });
    const view = marketingSwitchView({
      preferences: data.registry.get(marketingPreferencesAtom),
      save: data.registry.get(saveMarketingPreferenceAtom),
      requested: true,
    });
    screen.close();

    expect(outcome._tag).toBe("Success");
    expect(view).toEqual({
      granted: true,
      enabled: false,
      feedback: { kind: "saved" },
    });
  });

  test("keeps the shown state after a refused save", async () => {
    const data = makeFakeCustomerData("linked");
    const screen = await openScreen(data);
    data.workspace.fail("saveMarketingPreferences", "rate-limited");

    const { outcome } = await save(data, {
      context: data.workspace.data.marketing.context,
      granted: true,
    });
    screen.close();

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerRateLimited" },
    });
    expect(data.workspace.calls).toEqual([
      "getMarketingPreferences",
      "saveMarketingPreferences",
    ]);
  });
});

describe("marketingSwitchView", () => {
  const preferences = (
    status: "absent" | "active" | "withdrawn",
    waiting = false
  ) => AsyncResult.success({ status, context: "c" }, { waiting });

  test.each([
    ["absent", false],
    ["active", true],
    ["withdrawn", false],
  ] as const)("shows %s consent as granted=%s", (status, granted) => {
    expect(
      marketingSwitchView({
        preferences: preferences(status),
        save: AsyncResult.initial(),
        requested: undefined,
      })
    ).toEqual({ granted, enabled: true, feedback: undefined });
  });

  test("shows the choice and takes no input while saving", () => {
    expect(
      marketingSwitchView({
        preferences: preferences("absent"),
        save: AsyncResult.initial(true),
        requested: true,
      })
    ).toEqual({ granted: true, enabled: false, feedback: { kind: "saving" } });
  });

  test("keeps the choice until the saved state arrives", () => {
    expect(
      marketingSwitchView({
        preferences: preferences("absent", true),
        save: AsyncResult.success(undefined),
        requested: true,
      })
    ).toEqual({ granted: true, enabled: false, feedback: { kind: "saved" } });
    expect(
      marketingSwitchView({
        preferences: preferences("active"),
        save: AsyncResult.success(undefined),
        requested: true,
      })
    ).toEqual({ granted: true, enabled: true, feedback: { kind: "saved" } });
  });

  test("keeps the saved choice and takes no input when the read after it fails", () => {
    expect(
      marketingSwitchView({
        preferences: AsyncResult.failure(Cause.fail(new Error("unread")), {
          previousSuccess: Option.some(preferences("absent")),
        }),
        save: AsyncResult.success(undefined),
        requested: true,
      })
    ).toEqual({ granted: true, enabled: false, feedback: { kind: "saved" } });
  });

  test("shows the current state to review after a stale save", () => {
    expect(
      marketingSwitchView({
        preferences: preferences("withdrawn"),
        save: AsyncResult.fail(
          new CustomerMarketingPreferencesRejected({ reason: "stale-context" })
        ),
        requested: true,
      })
    ).toEqual({ granted: false, enabled: true, feedback: { kind: "stale" } });
  });

  test("shows the state read again after an unconfirmed save", () => {
    expect(
      marketingSwitchView({
        preferences: preferences("active"),
        save: AsyncResult.fail(new CustomerWriteUnconfirmed({})),
        requested: true,
      })
    ).toEqual({
      granted: true,
      enabled: true,
      feedback: { kind: "unconfirmed" },
    });
  });

  test("reports any other failure by its view error", () => {
    const view = marketingSwitchView({
      preferences: preferences("absent"),
      save: AsyncResult.failure(Cause.die("boom")),
      requested: true,
    });

    expect(view.granted).toBe(false);
    expect(view.feedback).toMatchObject({
      kind: "failed",
      error: { _tag: "Unexpected" },
    });
  });
});
