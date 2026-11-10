import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { loadingDieAnimation } from "@deskohub/brand-motion/loading-die";
import { brandColors } from "@deskohub/brand-tokens";
import LottieView from "lottie-react-native";
import { act, type ComponentProps, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { clientRoot } from "../testing/client-root";
import { LoadingIndicator } from "./loading-indicator";
import {
  type LoadingIndicatorProps,
  loadingIndicatorLayout,
  loadingIndicatorSemantics,
} from "./loading-indicator-presentation";
import { elementTree, find, type HostProps } from "./testing/element-tree";

type PlayerProps = ComponentProps<typeof LottieView>;

/** The indicator's outer view and its player, as it returns them. */
const drawn = (props: LoadingIndicatorProps) => {
  const tree = elementTree(LoadingIndicator, props) as ReactNode;
  const view = find(tree, "View");
  const player = find<PlayerProps>(tree, LottieView);
  if (view === undefined || player === undefined) throw new Error("No die.");
  return { view: view.props, player: player.props };
};

describe("LoadingIndicator", () => {
  test("plays the motion for its size in its tone, at its size", () => {
    const { view, player } = drawn({ size: "inline", tone: "navy" });
    const { width, height } = loadingIndicatorLayout("inline");
    expect(player.source).toBe(
      loadingDieAnimation({
        motion: "inPlace",
        fill: { kind: "solid", color: brandColors.navyBlue },
      }) as never
    );
    expect(player.loop).toBe(true);
    // Lottie's hardware path draws the small die without anti-aliasing on
    // some GPUs; the die's bitmap is small enough to draw in software.
    expect(player.renderMode).toBe("SOFTWARE");
    expect(player.style).toEqual({ width, height });
    expect((view as HostProps).style).toEqual({ width, height });
  });

  test("keeps the same document across renders, so the player keeps it", () => {
    const tone = { color: "#123456" } as const;
    expect(drawn({ size: "section", tone }).player.source).toBe(
      drawn({ size: "section", tone: { ...tone } }).player.source
    );
  });

  test.each([
    ["label", "a labelled"],
    [undefined, "an unlabelled"],
  ] as const)(
    "carries the semantics of %s indicator on its outer view",
    (label) => {
      const { view } = drawn({ size: "screen", tone: "brand", label });
      expect(view).toMatchObject(loadingIndicatorSemantics(label));
    }
  );

  test("shows the still logo until the motion preference is known", () => {
    expect(drawn({ size: "screen", tone: "brand" }).player.autoPlay).toBe(
      false
    );
  });
});

// The indicator runs inside a probe that draws only its player, so the ref
// and the indicator's effects run while the outer view, a name only, isn't
// drawn.
describe("LoadingIndicator and reduced motion", () => {
  const { render } = clientRoot();
  const accessibility = AccessibilityInfo as unknown as {
    isReduceMotionEnabled: () => Promise<boolean>;
    addEventListener: (
      event: string,
      listener: (enabled: boolean) => void
    ) => { readonly remove: () => void };
  };
  const { isReduceMotionEnabled, addEventListener } = accessibility;
  let reduced = false;
  let changed: (enabled: boolean) => void = () => undefined;
  const autoPlay: Array<boolean | undefined> = [];
  let resets = 0;
  // The player commands in the order the indicator sent them.
  const commands: Array<"play" | "reset"> = [];
  const spies: Array<{ readonly mockRestore: () => void }> = [];

  beforeEach(() => {
    autoPlay.length = 0;
    resets = 0;
    commands.length = 0;
    accessibility.isReduceMotionEnabled = async () => reduced;
    accessibility.addEventListener = (_event, listener) => {
      changed = listener;
      return { remove: () => undefined };
    };
    spies.push(
      spyOn(LottieView.prototype, "render").mockImplementation(function (
        this: LottieView
      ) {
        autoPlay.push(this.props.autoPlay);
        return null;
      }),
      spyOn(LottieView.prototype, "reset").mockImplementation(() => {
        resets += 1;
        commands.push("reset");
      }),
      spyOn(LottieView.prototype, "play").mockImplementation(() => {
        commands.push("play");
      })
    );
  });
  afterEach(async () => {
    await render(null);
    accessibility.isReduceMotionEnabled = isReduceMotionEnabled;
    accessibility.addEventListener = addEventListener;
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  const mount = async () => {
    const Probe = () =>
      find(LoadingIndicator({ size: "section", tone: "white" }), LottieView) ??
      null;
    await render(<Probe />);
    // The preference query answers on a later turn; let the probe take it.
    await act(async () => undefined);
  };

  test("plays once motion is known to be allowed", async () => {
    reduced = false;
    await mount();
    expect(autoPlay.at(-1)).toBe(true);
  });

  // Autoplay applies only when the player loads its document; a player that
  // loaded while the preference was unknown has to be told to play.
  test("plays after the still logo it showed while motion was unknown", async () => {
    reduced = false;
    await mount();
    expect(commands.at(-1)).toBe("play");
  });

  test("stays on the still logo while reduced motion is on", async () => {
    reduced = true;
    await mount();
    expect(autoPlay.at(-1)).toBe(false);
  });

  test("starts playing when reduced motion turns off", async () => {
    reduced = true;
    await mount();

    await act(async () => changed(false));

    expect(autoPlay.at(-1)).toBe(true);
    expect(commands.at(-1)).toBe("play");
  });

  test("goes back to the still logo when reduced motion turns on", async () => {
    reduced = false;
    await mount();
    const before = resets;

    await act(async () => changed(true));

    expect(autoPlay.at(-1)).toBe(false);
    expect(resets).toBeGreaterThan(before);
  });
});
