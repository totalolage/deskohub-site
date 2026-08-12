import { expect, test } from "bun:test";
import {
  workspaceE2ECaseIds,
  workspaceE2ENonPaymentCaseIds,
  workspaceE2EPaymentCaseLanes,
  workspaceE2ESharedFixtureCaseIds,
} from "./case-catalog";

test("registers every checkout case once in a Playwright-owned lane", () => {
  expect(workspaceE2ECaseIds).toHaveLength(32);
  expect(new Set(workspaceE2ECaseIds).size).toBe(32);
  expect(workspaceE2ENonPaymentCaseIds).toHaveLength(17);
  expect(workspaceE2EPaymentCaseLanes.map((lane) => lane.length)).toEqual([
    5, 5, 4,
  ]);
  expect(workspaceE2ESharedFixtureCaseIds).toEqual([
    "calendar-sale-pricing-changes",
  ]);
});
