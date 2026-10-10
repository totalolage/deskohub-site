import { expect, test } from "bun:test";
import { parseReferralCaptureArgs } from "./capture-referral-states";
import {
  checkoutVisualCapturePlan,
  referralVisualCaptureChecklist,
  referralVisualCapturePlan,
  referralVisualScenarios,
} from "./referral-visual-fixtures";
import { defaultOutputRoot } from "./run";

test("synthetic referral coverage fixes every state, locale, viewport, and filename", () => {
  const referralCaptures = referralVisualCapturePlan();
  const checkoutCaptures = checkoutVisualCapturePlan();
  const captures = [...referralCaptures, ...checkoutCaptures];

  expect(referralVisualScenarios).toEqual([
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
  ]);
  expect(referralCaptures).toHaveLength(40);
  expect(checkoutCaptures).toHaveLength(4);
  expect(captures).toHaveLength(44);
  expect(new Set(captures.map(({ filename }) => filename)).size).toBe(44);
  expect(captures).toContainEqual(
    expect.objectContaining({
      filename: "synthetic-referral-already-attributed-mobile-cs-CZ.png",
      locale: "cs-CZ",
      scenario: "already-attributed",
      viewport: expect.objectContaining({ name: "mobile" }),
    })
  );
  expect(captures).toContainEqual(
    expect.objectContaining({
      filename: "synthetic-checkout-code-unavailable-desktop-en-US.png",
      scenario: "checkout-code-unavailable",
    })
  );
  expect(referralVisualCaptureChecklist).toMatchObject({
    evidenceType:
      "synthetic component renderer; not protected-preview evidence",
    referralCaptureCount: 40,
    checkoutCaptureCount: 4,
    totalCaptureCount: 44,
    locales: ["en-US", "cs-CZ"],
    viewports: ["desktop", "mobile"],
  });
});

test("capture command only accepts a label, output root, and renderer port", () => {
  expect(parseReferralCaptureArgs(["--label", "referrals-synthetic"])).toEqual({
    label: "referrals-synthetic",
    outputRoot: defaultOutputRoot,
    port: 3111,
  });
  expect(() =>
    parseReferralCaptureArgs([
      "--label",
      "referrals-synthetic",
      "--scenario",
      "accepted",
    ])
  ).toThrow(/Unknown argument: --scenario/);
  expect(() => parseReferralCaptureArgs(["--label", "../outside"])).toThrow(
    /lowercase letters, numbers, and hyphens/
  );
  expect(() =>
    parseReferralCaptureArgs([
      "--label",
      "referrals-synthetic",
      "--port",
      "70000",
    ])
  ).toThrow(/integer from 1 through 65535/);
});
