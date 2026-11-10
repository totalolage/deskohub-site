import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  loadingDieBrandGradient,
  loadingDieFrame,
  loadingDieTiming,
} from "@deskohub/brand-motion/loading-die";
import { act, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { clientRoot } from "../testing/client-root";
import { LoadingIndicator } from "./loading-indicator.web";
import {
  type LoadingIndicatorProps,
  loadingIndicatorLayout,
  loadingIndicatorSemantics,
} from "./loading-indicator-presentation";
import {
  find,
  findAll,
  type HostProps,
  hostTree,
} from "./testing/element-tree";

const { render } = clientRoot();
const accessibility = AccessibilityInfo as unknown as {
  isReduceMotionEnabled: () => Promise<boolean>;
  addEventListener: (
    event: string,
    listener: (enabled: boolean) => void
  ) => { readonly remove: () => void };
};
const { isReduceMotionEnabled, addEventListener } = accessibility;
let changeReducedMotion: (enabled: boolean) => void = () => undefined;

/** Animation frames wait here until a test runs them at a time it names. */
const requested = new Map<number, FrameRequestCallback>();
let lastRequest = 0;
const browser = globalThis as {
  requestAnimationFrame: typeof requestAnimationFrame;
  cancelAnimationFrame: typeof cancelAnimationFrame;
};
const { requestAnimationFrame: request, cancelAnimationFrame: cancel } =
  browser;
const runFrameAt = (now: number) =>
  act(async () => {
    const callbacks = [...requested.values()];
    requested.clear();
    for (const callback of callbacks) callback(now);
  });

beforeEach(() => {
  browser.requestAnimationFrame = (callback) => {
    lastRequest += 1;
    requested.set(lastRequest, callback);
    return lastRequest;
  };
  browser.cancelAnimationFrame = (id) => {
    if (typeof id === "number") requested.delete(id);
  };
  accessibility.addEventListener = (_event, listener) => {
    changeReducedMotion = listener;
    return { remove: () => undefined };
  };
});
afterEach(async () => {
  await render(null);
  requested.clear();
  browser.requestAnimationFrame = request;
  browser.cancelAnimationFrame = cancel;
  accessibility.isReduceMotionEnabled = isReduceMotionEnabled;
  accessibility.addEventListener = addEventListener;
});

/**
 * Runs the indicator inside a probe, so its hooks and frame loop run, and
 * reads the tree it returned last. The tree isn't drawn: the outer view
 * only stands in as a name.
 */
const draw = async (
  props: LoadingIndicatorProps,
  { reduced }: { readonly reduced: boolean }
) => {
  accessibility.isReduceMotionEnabled = async () => reduced;
  let tree: ReactNode = null;
  const Probe = () => {
    tree = LoadingIndicator(props);
    return null;
  };
  await render(<Probe />);
  // The preference query answers on a later turn; let the probe take it.
  await act(async () => undefined);
  return {
    tree: () => tree,
    faces: () =>
      findAll(tree, "path").map((path) => (path.props as HostProps).d),
    group: () => find(tree, "g")?.props as HostProps,
  };
};

/** The time at which the loop shows `frame`, for a loop that started at 0. */
const timeOf = (frame: number) =>
  (frame / loadingDieTiming.framesPerSecond) * 1000;

describe("the web LoadingIndicator", () => {
  test("draws the still logo and asks for no frames while reduced motion is on", async () => {
    const indicator = await draw(
      { size: "section", tone: "white" },
      { reduced: true }
    );
    const still = loadingDieFrame("tumble", 0);
    expect(requested.size).toBe(0);
    expect(indicator.faces()).toEqual([...still.faces]);
    expect(indicator.group().transform).toBe(still.transform);
    expect(indicator.group().fill).toBe("#ffffff");
  });

  test("plays the loop at the motion's frame rate while motion is allowed", async () => {
    const indicator = await draw(
      { size: "inline", tone: { color: "#123456" } },
      { reduced: false }
    );
    await runFrameAt(0);
    await runFrameAt(timeOf(15));

    const shown = loadingDieFrame("inPlace", 15);
    expect(indicator.faces()).toEqual([...shown.faces]);
    expect(indicator.group().transform).toBe(shown.transform);
    expect(indicator.group().fill).toBe("#123456");
  });

  test("goes back to the still logo and stops when reduced motion turns on", async () => {
    const indicator = await draw(
      { size: "section", tone: "white" },
      { reduced: false }
    );
    await runFrameAt(0);
    await runFrameAt(timeOf(30));

    await act(async () => changeReducedMotion(true));

    expect(requested.size).toBe(0);
    expect(indicator.faces()).toEqual([...loadingDieFrame("tumble", 0).faces]);
  });

  test("stops asking for frames once unmounted", async () => {
    await draw({ size: "section", tone: "white" }, { reduced: false });
    await runFrameAt(0);
    expect(requested.size).toBe(1);

    await render(null);

    expect(requested.size).toBe(0);
  });

  test("draws at its size, over the motion's whole frame", async () => {
    const indicator = await draw(
      { size: "screen", tone: "navy" },
      { reduced: true }
    );
    const { width, height } = loadingIndicatorLayout("screen");
    const svg = find(indicator.tree(), "svg")?.props as HostProps;
    expect(svg.width).toBe(width);
    expect(svg.height).toBe(height);
    expect(svg["aria-hidden"]).toBe(true);
  });

  test("fills the brand tone with the logo's gradient", async () => {
    const indicator = await draw(
      { size: "screen", tone: "brand" },
      { reduced: true }
    );
    const drawn = hostTree(indicator.tree());
    const gradient = find(drawn, "linearGradient")?.props as HostProps;
    const { from, to } = loadingDieBrandGradient("tumble");
    expect(gradient.gradientUnits).toBe("userSpaceOnUse");
    expect([gradient.x1, gradient.y1, gradient.x2, gradient.y2]).toEqual([
      from.x,
      from.y,
      to.x,
      to.y,
    ]);
    expect(
      findAll(drawn, "stop").map((stop) => (stop.props as HostProps).stopColor)
    ).toEqual([from.color, to.color]);
    expect(indicator.group().fill).toBe(`url(#${gradient.id})`);
  });

  test.each([["label"], [undefined]] as const)(
    "carries the native semantics for label %p",
    async (label) => {
      const indicator = await draw(
        { size: "section", tone: "white", label },
        { reduced: true }
      );
      expect(find(indicator.tree(), "View")?.props).toMatchObject(
        loadingIndicatorSemantics(label)
      );
    }
  );
});
