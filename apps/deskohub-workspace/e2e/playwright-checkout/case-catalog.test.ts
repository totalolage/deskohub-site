import { expect, test } from "bun:test";
import {
  workspaceE2EPlaywrightCheckoutTimeout,
  workspaceE2ETimeouts,
} from "../timeouts";
import {
  workspaceE2ECaseIds,
  workspaceE2ENonPaymentCaseIds,
  workspaceE2EPaymentCaseLanes,
  workspaceE2ESharedFixtureCaseIds,
} from "./case-catalog";

test("registers every checkout case once in a Playwright-owned lane", () => {
  expect(workspaceE2ECaseIds).toHaveLength(36);
  expect(new Set(workspaceE2ECaseIds).size).toBe(36);
  expect(workspaceE2ENonPaymentCaseIds).toHaveLength(18);
  expect(workspaceE2EPaymentCaseLanes.map((lane) => lane.length)).toEqual([
    6, 6, 5,
  ]);
  expect(workspaceE2ESharedFixtureCaseIds).toEqual([
    "calendar-sale-pricing-changes",
  ]);
});

test("keeps the Playwright watchdog outside the longest semantic case", () => {
  const checkoutRequirement =
    workspaceE2ETimeouts.checkoutCase * 2 +
    workspaceE2ETimeouts.artifactCapture +
    workspaceE2ETimeouts.cleanupAction +
    workspaceE2ETimeouts.datasource;
  expect(workspaceE2EPlaywrightCheckoutTimeout).toBeGreaterThanOrEqual(
    checkoutRequirement
  );

  const accountRequirement =
    workspaceE2ETimeouts.accountCase +
    workspaceE2ETimeouts.artifactCapture +
    workspaceE2ETimeouts.cleanupAction;
  expect(workspaceE2EPlaywrightCheckoutTimeout).toBeGreaterThanOrEqual(
    accountRequirement
  );
});
