import {
  type LoadingDieFill,
  type LoadingDieMotion,
  loadingDieBox,
} from "@deskohub/brand-motion/loading-die";
import { brandColors } from "@deskohub/brand-tokens";
import { theme } from "../theme";

/**
 * Where the indicator stands: `inline` next to text or inside a button,
 * `section` in place of a part of a screen, `screen` alone on a screen.
 */
export type LoadingIndicatorSize = "inline" | "section" | "screen";

/** The die's colour: white, navy, the logo's brand gradient, or an explicit `#rrggbb` colour. */
export type LoadingIndicatorTone =
  | "white"
  | "navy"
  | "brand"
  | { readonly color: `#${string}` };

export interface LoadingIndicatorProps {
  readonly size: LoadingIndicatorSize;
  readonly tone: LoadingIndicatorTone;
  /**
   * What assistive tech announces. Without one the indicator is hidden from
   * it, for places whose own text or busy state already says what's loading.
   */
  readonly label?: string;
}

/** The die's height at rest for each size, in dp. */
const dieHeight = {
  inline: 20,
  section: 32,
  screen: 64,
} as const satisfies Record<LoadingIndicatorSize, number>;

/**
 * The motion for `size` and the size it draws at, in dp: next to text the die
 * rolls in place; elsewhere it tumbles, with room above for its hop. The
 * motion's whole frame is scaled so the die at rest is as tall as the size.
 */
export const loadingIndicatorLayout = (
  size: LoadingIndicatorSize
): {
  readonly motion: LoadingDieMotion;
  readonly width: number;
  readonly height: number;
} => {
  const motion = size === "inline" ? "inPlace" : "tumble";
  const box = loadingDieBox(motion);
  const scale = dieHeight[size] / box.dieHeight;
  return { motion, width: box.width * scale, height: box.height * scale };
};

/** The faces' fill for `tone`. */
export const loadingIndicatorFill = (
  tone: LoadingIndicatorTone
): LoadingDieFill => {
  if (tone === "brand") return { kind: "brand" };
  if (tone === "white") return { kind: "solid", color: theme.colors.text };
  if (tone === "navy") return { kind: "solid", color: brandColors.navyBlue };
  return { kind: "solid", color: tone.color };
};

/**
 * The accessibility props of the indicator's outer view: a busy progress bar
 * named `label`, one element for assistive tech (iOS reads a view only when
 * it is `accessible`), or, without a label, hidden from assistive tech
 * together with everything inside it.
 */
export const loadingIndicatorSemantics = (label: string | undefined) =>
  label === undefined
    ? ({
        "aria-hidden": true,
        importantForAccessibility: "no-hide-descendants",
      } as const)
    : ({
        accessible: true,
        role: "progressbar",
        "aria-label": label,
        "aria-busy": true,
      } as const);
