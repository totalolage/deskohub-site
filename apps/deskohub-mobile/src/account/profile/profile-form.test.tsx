import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Option } from "effect";
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import type { CompletionTextField } from "./profile-draft";
import type { ProfileSubmitState } from "./profile-save";

/**
 * A stand-in for the stack navigator around each guarded screen: the routes
 * it holds, whether a screen is focused, and the removal prevention each
 * screen asks for, which a test triggers as the navigator would.
 */
const navigator = {
  routes: [] as Array<{ key: string; name: string }>,
  focused: true,
  prevention: new Map<
    string,
    { prevent: boolean; blocked: (event: { repeat: () => void }) => void }
  >(),
};
let currentKey = "";

mock.module("expo-router", () => ({
  useNavigation: () => ({ getState: () => ({ routes: navigator.routes }) }),
  useRoute: () => ({ key: currentKey }),
  useIsFocused: () => navigator.focused,
  usePreventRemove: (
    prevent: boolean,
    blocked: (event: { repeat: () => void }) => void
  ) => {
    navigator.prevention.set(currentKey, { prevent, blocked });
    return () => undefined;
  },
}));

const { returnsToSharedDraft, useFocusFirstInvalid, useUnsavedChangesGuard } =
  await import("./profile-form");
const { ProfileSubmitState: SubmitState } = await import("./profile-save");

let root: Root;
beforeAll(async () => {
  GlobalRegistrator.register();
  // React reads the act environment flag only once a DOM exists.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.createElement("div"));
});
afterAll(async () => {
  await act(async () => root.unmount());
  await GlobalRegistrator.unregister();
});

const render = async (element: Parameters<Root["render"]>[0]) =>
  act(async () => root.render(element));

type Guard = ReturnType<typeof useUnsavedChangesGuard>;

/** A screen with unsaved edits until they're discarded. */
const guardedScreen = (
  screenKey: string,
  sharedWith: ReadonlyArray<string>
) => {
  const seen: { guard?: Guard; discarded: number } = { discarded: 0 };
  function Screen() {
    currentKey = screenKey;
    const [unsaved, setUnsaved] = useState(true);
    seen.guard = useUnsavedChangesGuard({
      unsaved,
      onDiscard: () => {
        seen.discarded += 1;
        setUnsaved(false);
      },
      sharedWith,
    });
    return null;
  }
  return { Screen, seen };
};

const block = async (screenKey: string) => {
  const repeat = mock(() => undefined);
  await act(async () =>
    navigator.prevention.get(screenKey)?.blocked({ repeat })
  );
  return repeat;
};

describe("returnsToSharedDraft", () => {
  const routes = [
    { key: "i", name: "index" },
    { key: "b", name: "billing" },
    { key: "p", name: "profile" },
  ];

  test("going back to the other editor of the draft keeps it", () => {
    expect(
      returnsToSharedDraft({ routes, key: "p", sharedWith: ["billing"] })
    ).toBe(true);
  });

  test("leaving the editors asks, also when one action removes both", () => {
    // popTo the index from Profile: Profile goes back to Billing, but Billing
    // itself goes back to the index, so Billing asks.
    expect(
      returnsToSharedDraft({ routes, key: "b", sharedWith: ["profile"] })
    ).toBe(false);
    expect(
      returnsToSharedDraft({
        routes: [routes[0], routes[2]] as typeof routes,
        key: "p",
        sharedWith: ["billing"],
      })
    ).toBe(false);
  });
});

describe("useUnsavedChangesGuard", () => {
  test("prevents leaving with unsaved changes and asks only once blocked", async () => {
    navigator.routes = [
      { key: "i", name: "index" },
      { key: "p", name: "profile" },
    ];
    const { Screen, seen } = guardedScreen("p", ["billing"]);
    await render(createElement(Screen));

    expect(navigator.prevention.get("p")?.prevent).toBe(true);
    expect(seen.guard?.asking).toBe(false);
    await block("p");
    expect(seen.guard?.asking).toBe(true);
  });

  test("keep editing cancels the navigation and keeps the edits", async () => {
    navigator.routes = [
      { key: "i", name: "index" },
      { key: "p2", name: "profile" },
    ];
    const { Screen, seen } = guardedScreen("p2", ["billing"]);
    await render(createElement(Screen));
    const repeat = await block("p2");

    await act(async () => seen.guard?.keepEditing());

    expect(seen.guard?.asking).toBe(false);
    expect(repeat).not.toHaveBeenCalled();
    expect(seen.discarded).toBe(0);
    expect(navigator.prevention.get("p2")?.prevent).toBe(true);
  });

  test("discard drops the edits, then completes the navigation once", async () => {
    navigator.routes = [
      { key: "i", name: "index" },
      { key: "p3", name: "profile" },
    ];
    const { Screen, seen } = guardedScreen("p3", ["billing"]);
    await render(createElement(Screen));
    const repeat = await block("p3");

    await act(async () => seen.guard?.discard());

    expect(seen.discarded).toBe(1);
    expect(repeat).toHaveBeenCalledTimes(1);
    expect(seen.guard?.asking).toBe(false);
    expect(navigator.prevention.get("p3")?.prevent).toBe(false);
  });

  test("back from Profile to Billing isn't prevented; Billing still guards the draft", async () => {
    navigator.routes = [
      { key: "i", name: "index" },
      { key: "b4", name: "billing" },
      { key: "p4", name: "profile" },
    ];
    const billing = guardedScreen("b4", ["profile"]);
    const profile = guardedScreen("p4", ["billing"]);
    await render(
      createElement(
        "div",
        null,
        createElement(billing.Screen),
        createElement(profile.Screen)
      )
    );

    expect(navigator.prevention.get("p4")?.prevent).toBe(false);
    expect(navigator.prevention.get("b4")?.prevent).toBe(true);
    expect(profile.seen.discarded + billing.seen.discarded).toBe(0);
  });
});

describe("useFocusFirstInvalid", () => {
  const refusal = (field: CompletionTextField): ProfileSubmitState =>
    SubmitState.Invalid({
      invalid: { fields: { [field]: "invalid" }, first: Option.some(field) },
      attempt: {},
    });

  const focusScreen = () => {
    const focus = mock(() => undefined);
    const seen: { elsewhere?: boolean } = {};
    function Screen({ state }: { readonly state: ProfileSubmitState }) {
      const { inputs, invalidElsewhere } = useFocusFirstInvalid(state, [
        "firstName",
        "phone",
      ] as const);
      inputs.current.set("phone", { focus } as never);
      seen.elsewhere = invalidElsewhere;
      return null;
    }
    return { Screen, focus, seen };
  };

  test("focuses the first invalid field once per refusal, again on the next", async () => {
    navigator.focused = true;
    const { Screen, focus } = focusScreen();
    const first = refusal("phone");

    await render(createElement(Screen, { state: first }));
    await render(createElement(Screen, { state: first }));
    expect(focus).toHaveBeenCalledTimes(1);

    await render(createElement(Screen, { state: refusal("phone") }));
    expect(focus).toHaveBeenCalledTimes(2);
  });

  test("a screen in the background doesn't take focus", async () => {
    navigator.focused = false;
    const { Screen, focus } = focusScreen();

    await render(createElement(Screen, { state: refusal("phone") }));

    expect(focus).not.toHaveBeenCalled();
    navigator.focused = true;
  });

  test("a field on the other screen is pointed at, not focused", async () => {
    const { Screen, focus, seen } = focusScreen();

    await render(createElement(Screen, { state: refusal("city") }));

    expect(focus).not.toHaveBeenCalled();
    expect(seen.elsewhere).toBe(true);
  });
});
