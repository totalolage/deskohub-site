import { afterEach, describe, expect, test } from "bun:test";
import {
  loadingDieBrandGradient,
  loadingDieFrame,
} from "@deskohub/brand-motion/loading-die";
import { Effect } from "effect";
import { act, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { clientRoot } from "../testing/client-root";
import { eventually, quietly } from "../testing/eventually";
import { LoadingIndicator } from "./loading-indicator.web";
import {
  type LoadingIndicatorProps,
  loadingIndicatorLayout,
  loadingIndicatorSemantics,
} from "./loading-indicator-presentation";
import { find, findAll, type HostProps } from "./testing/element-tree";

const { render } = clientRoot();
const accessibility = AccessibilityInfo as unknown as {
  isReduceMotionEnabled: () => Promise<boolean>;
};
const { isReduceMotionEnabled } = accessibility;

afterEach(async () => {
  await render(null);
  accessibility.isReduceMotionEnabled = isReduceMotionEnabled;
});

/**
 * Runs the indicator inside a probe, so its hooks and frame loop run, and
 * returns the tree it returned last. The tree isn't drawn: the outer view
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
  const faces = () =>
    findAll(tree, "path").map((path) => (path.props as HostProps).d);
  const group = () => find(tree, "g")?.props as HostProps;
  return { tree: () => tree, faces, group };
};

describe("the web LoadingIndicator", () => {
  test("draws the still logo while reduced motion is on", async () => {
    const indicator = await draw(
      { size: "section", tone: "white" },
      { reduced: true }
    );
    await act(() => Effect.runPromise(quietly));
    const still = loadingDieFrame("tumble", 0);
    expect(indicator.faces()).toEqual([...still.faces]);
    expect(indicator.group().transform).toBe(still.transform);
    expect(indicator.group().fill).toBe("#ffffff");
  });

  test("moves on from the still logo while motion is allowed", async () => {
    const indicator = await draw(
      { size: "inline", tone: { color: "#123456" } },
      { reduced: false }
    );
    const still = loadingDieFrame("inPlace", 0);
    await act(() =>
      Effect.runPromise(
        eventually(
          () =>
            JSON.stringify(indicator.faces()) !== JSON.stringify(still.faces)
        )
      )
    );
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
    const gradient = find(indicator.tree(), "linearGradient")
      ?.props as HostProps;
    const { from, to } = loadingDieBrandGradient("tumble");
    expect(gradient.gradientUnits).toBe("userSpaceOnUse");
    expect([gradient.x1, gradient.y1, gradient.x2, gradient.y2]).toEqual([
      from.x,
      from.y,
      to.x,
      to.y,
    ]);
    expect(
      findAll(indicator.tree(), "stop").map(
        (stop) => (stop.props as HostProps).stopColor
      )
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
