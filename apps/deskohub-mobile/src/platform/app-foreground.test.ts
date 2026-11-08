import { describe, expect, test } from "bun:test";
import { AtomRegistry } from "effect/unstable/reactivity";
import type { AppStateStatus } from "react-native";
import { type AppStateSource, makeAppForegroundAtom } from "./app-foreground";

const fakeAppState = (initial: AppStateStatus) => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const source: AppStateSource = {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const change = (state: AppStateStatus) => {
    for (const listener of listeners) listener(state);
  };
  return { source, change, listeners };
};

describe("makeAppForegroundAtom", () => {
  test("starts from the current app state", () => {
    const registry = AtomRegistry.make();

    expect(
      registry.get(makeAppForegroundAtom(fakeAppState("active").source))
    ).toBe(true);
    expect(
      registry.get(makeAppForegroundAtom(fakeAppState("background").source))
    ).toBe(false);
  });

  test("follows the app into the background and back", () => {
    const appState = fakeAppState("active");
    const foreground = makeAppForegroundAtom(appState.source);
    const registry = AtomRegistry.make();
    const seen: Array<boolean> = [];
    const unmount = registry.subscribe(
      foreground,
      (value) => seen.push(value),
      {
        immediate: true,
      }
    );

    appState.change("background");
    appState.change("inactive");
    appState.change("active");

    // A repeated state is no change.
    expect(seen).toEqual([true, false, true]);
    unmount();
  });

  test("stops listening once nothing reads it", async () => {
    const appState = fakeAppState("active");
    const foreground = makeAppForegroundAtom(appState.source);
    const registry = AtomRegistry.make();

    const unmount = registry.mount(foreground);
    expect(appState.listeners.size).toBe(1);
    unmount();
    // The registry removes an unread atom on a later task.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appState.listeners.size).toBe(0);
  });
});
