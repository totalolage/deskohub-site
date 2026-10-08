import type { AccountVisualLocale } from "./types";

export const syntheticReferralCode = "RFL12345";

export const referralVisualScenarios = [
  "summary-unavailable",
  "copy-success",
  "copy-failure",
  "invitation-eligible",
  "accepted",
  "already-accepted",
  "self-referral",
  "already-attributed",
  "ineligible",
  "unavailable",
] as const;

export type ReferralVisualScenario = (typeof referralVisualScenarios)[number];

export const referralVisualViewports = [
  { name: "desktop", width: 1280, height: 1400, deviceScaleFactor: 2 },
  { name: "mobile", width: 375, height: 1000, deviceScaleFactor: 1 },
] as const;

export type ReferralVisualViewport = (typeof referralVisualViewports)[number];

export const checkoutVisualScenarios = ["checkout-code-unavailable"] as const;

export type CheckoutVisualScenario = (typeof checkoutVisualScenarios)[number];

export type ReferralVisualCapture = {
  readonly scenario: ReferralVisualScenario;
  readonly locale: AccountVisualLocale;
  readonly viewport: ReferralVisualViewport;
  readonly filename: string;
};

export type CheckoutVisualCapture = {
  readonly scenario: CheckoutVisualScenario;
  readonly locale: AccountVisualLocale;
  readonly viewport: ReferralVisualViewport;
  readonly filename: string;
};

export const referralVisualCaptureChecklist = {
  evidenceType: "synthetic component renderer; not protected-preview evidence",
  referralScenarios: referralVisualScenarios,
  checkoutScenarios: checkoutVisualScenarios,
  locales: ["en-US", "cs-CZ"] as const,
  viewports: referralVisualViewports.map(({ name }) => name),
  referralCaptureCount: 40,
  checkoutCaptureCount: 4,
  totalCaptureCount: 44,
  screenshotMasks: [
    "referral codes and share links",
    "submitted discount-code input values",
  ],
} as const;

export const referralVisualCapturePlan = (
  locales: readonly AccountVisualLocale[] = ["en-US", "cs-CZ"]
): readonly ReferralVisualCapture[] =>
  referralVisualScenarios.flatMap((scenario) =>
    locales.flatMap((locale) =>
      referralVisualViewports.map((viewport) => ({
        scenario,
        locale,
        viewport,
        filename: `synthetic-referral-${scenario}-${viewport.name}-${locale}.png`,
      }))
    )
  );

export const checkoutVisualCapturePlan = (
  locales: readonly AccountVisualLocale[] = ["en-US", "cs-CZ"]
): readonly CheckoutVisualCapture[] =>
  checkoutVisualScenarios.flatMap((scenario) =>
    locales.flatMap((locale) =>
      referralVisualViewports.map((viewport) => ({
        scenario,
        locale,
        viewport,
        filename: `synthetic-${scenario}-${viewport.name}-${locale}.png`,
      }))
    )
  );

export const isReferralVisualScenario = (
  value: string
): value is ReferralVisualScenario =>
  (referralVisualScenarios as readonly string[]).includes(value);
