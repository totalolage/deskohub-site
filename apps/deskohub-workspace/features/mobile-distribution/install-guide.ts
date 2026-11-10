import type { InstallPlatform } from "./install-platform";

/**
 * Which add-to-Home-Screen guide fits the visitor's browser. Guides with a
 * known toolbar point arrows at the real control; the rest show the steps
 * without arrows.
 *
 * Contract for #1200, filled in by the guide stream: keep these exported
 * names; the variants may still change.
 */
export type InstallGuide = {
  readonly kind: "unidentified";
};

export type InstallGuideSignals = {
  readonly platform: InstallPlatform;
  readonly userAgent: string;
  readonly maxTouchPoints: number;
};

/** Picks the guide for a browser that has no install prompt of its own. */
export const detectInstallGuide = (
  _signals: InstallGuideSignals
): InstallGuide => ({ kind: "unidentified" });
