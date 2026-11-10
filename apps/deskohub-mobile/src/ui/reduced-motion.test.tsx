import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { AccessibilityInfo } from "react-native";
import { clientRoot } from "../testing/client-root";
import { useReducedMotion } from "./reduced-motion";

type Listener = (enabled: boolean) => void;

/** The parts of `AccessibilityInfo` the hook uses, as each test sets them. */
const accessibility = AccessibilityInfo as unknown as {
  isReduceMotionEnabled: () => Promise<boolean>;
  addEventListener: (
    event: string,
    listener: Listener
  ) => { readonly remove: () => void };
};
const { isReduceMotionEnabled, addEventListener } = accessibility;

const { render } = clientRoot();

/** The device's answer to the query, given when a test says so. */
let answer: (enabled: boolean) => void;
const listeners = new Set<Listener>();
const change = (enabled: boolean) =>
  act(async () => {
    for (const listener of listeners) listener(enabled);
  });

beforeEach(() => {
  accessibility.isReduceMotionEnabled = () =>
    new Promise((resolve) => {
      answer = resolve;
    });
  accessibility.addEventListener = (event, listener) => {
    if (event === "reduceMotionChanged") listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  };
});
afterEach(async () => {
  await render(null);
  accessibility.isReduceMotionEnabled = isReduceMotionEnabled;
  accessibility.addEventListener = addEventListener;
});

/** Mounts the hook and returns what it reported last. */
const mount = async () => {
  let reduced: boolean | undefined;
  const Probe = () => {
    reduced = useReducedMotion();
    return null;
  };
  await render(<Probe />);
  return () => reduced;
};

describe("useReducedMotion", () => {
  test("is unknown until the device answers, then follows it", async () => {
    const reduced = await mount();
    expect(reduced()).toBeUndefined();

    await act(async () => answer(true));
    expect(reduced()).toBe(true);

    await change(false);
    expect(reduced()).toBe(false);
  });

  test("keeps a change reported before the answer", async () => {
    const reduced = await mount();

    await change(true);
    await act(async () => answer(false));

    expect(reduced()).toBe(true);
  });

  test("stops listening once unmounted", async () => {
    await mount();
    expect(listeners.size).toBe(1);

    await render(null);

    expect(listeners.size).toBe(0);
  });
});
