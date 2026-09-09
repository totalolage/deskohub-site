import type { ComponentType } from "react";

export const accountVisualScreens = [
  "profile",
  "billing",
  "legal",
  "danger",
  "reservations",
] as const;

export type AccountVisualScreen = (typeof accountVisualScreens)[number];
export const accountVisualLocales = ["en-US", "cs-CZ"] as const;
export type AccountVisualLocale = (typeof accountVisualLocales)[number];

export type AccountVisualAdapterProps = {
  readonly screen: AccountVisualScreen;
  readonly locale: AccountVisualLocale;
};

export type AccountVisualAdapter = ComponentType<AccountVisualAdapterProps>;

export const accountVisualRendererMethodVersion =
  "layout-neutral-unavailable-annotation-v2" as const;
export const accountVisualHistoricalCaptureMethodVersion =
  "layout-changing-unavailable-annotation-v1" as const;
export const accountVisualHistoricalBaselineComparabilityReason =
  "annotation-layout-changed" as const;
export const accountVisualIterationComparabilityRule =
  "eligible only when rendererMethodVersion, fixture, and locale match" as const;

export type AccountVisualAdapterMetadata = {
  readonly owner: string;
  readonly fixture: string;
};

export type AccountVisualComparisonMetadata = {
  readonly referenceLocale: AccountVisualLocale;
  readonly captureLocale: AccountVisualLocale;
  readonly copyMismatch: boolean;
  readonly fixture: string;
  readonly rendererMethodVersion: typeof accountVisualRendererMethodVersion;
  readonly historicalBaselineComparability: false;
  readonly historicalBaselineComparabilityReason: typeof accountVisualHistoricalBaselineComparabilityReason;
  readonly iterationComparabilityRule: typeof accountVisualIterationComparabilityRule;
  readonly controlledComparability: false;
  readonly controlledComparabilityCaveat: string;
};

export const defaultAccountVisualAdapterMetadata = {
  owner: "account-visual default adapter",
  fixture: "linked synthetic customer account: ada@example.test",
} as const satisfies AccountVisualAdapterMetadata;

/**
 * Adapters are bundled from a caller-owned TSX module; they own integrated
 * shell and screen composition while this seam owns the real AccountPage
 * default. The standalone runner invokes one adapter-backed run at a time.
 */
export const isAccountVisualScreen = (
  value: string | null
): value is AccountVisualScreen =>
  value !== null && (accountVisualScreens as readonly string[]).includes(value);

export const isAccountVisualLocale = (
  value: string | undefined
): value is AccountVisualLocale =>
  value !== undefined &&
  (accountVisualLocales as readonly string[]).includes(value);
