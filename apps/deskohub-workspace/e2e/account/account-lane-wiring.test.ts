import { expect, test } from "bun:test";
import {
  countOccurrences,
  extractStepIds,
  extractStringLiterals,
  readTrackedSource,
  sliceBetween,
} from "@/scripts/shared/source-contract";

/**
 * The serial account lane is the only runner that captures the authenticated
 * linked-section review targets. These assertions pin the wiring in the lane
 * source so a mobile linked-section capture can never silently disappear from
 * the deployed run without breaking a test.
 */
test("wires mobile linked-section captures after the desktop captures", () => {
  const lane = readTrackedSource(
    new URL("./account-lane.pw.ts", import.meta.url).pathname
  );

  // Step identifiers must appear exactly once and in this deployed order.
  const stepIds = extractStepIds(lane);
  const layoutStepIndex = stepIds.indexOf("checks account layout navigation");
  const marketingStepIndex = stepIds.indexOf(
    "checks account marketing preferences"
  );
  expect(layoutStepIndex).toBeGreaterThan(-1);
  expect(marketingStepIndex).toBe(layoutStepIndex + 1);

  // Isolate the section-capture callback handed to the layout-navigation flow.
  const callback = sliceBetween(
    lane,
    "verifyAccountLayoutNavigation(page, async (section) => {",
    "}),"
  );
  expect(callback).not.toBe("");

  // The awaited desktop capture precedes the awaited conditional mobile
  // capture, and the mobile call is a real captureAccountReview invocation of
  // the mobile target inside the same callback block.
  const desktopTargetAt = callback.indexOf(
    "accountReviewTargetBySection[section]"
  );
  const mobileLookupAt = callback.indexOf(
    "mobileAccountReviewTargetBySection[section]"
  );
  const mobileGuardAt = callback.indexOf("if (mobileTarget)");
  expect(callback.indexOf("await captureAccountReview(")).toBeGreaterThan(-1);
  expect(desktopTargetAt).toBeGreaterThan(-1);
  expect(mobileLookupAt).toBeGreaterThan(desktopTargetAt);
  expect(mobileGuardAt).toBeGreaterThan(mobileLookupAt);
  expect(
    callback.indexOf("await captureAccountReview(", mobileGuardAt)
  ).toBeGreaterThan(mobileGuardAt);
  expect(countOccurrences(callback, "await captureAccountReview(")).toBe(2);

  // Pin the five-entry mobile mapping: only reservations, billing, and danger
  // gain a mobile capture; profile and legal stay desktop-only.
  const mapping = sliceBetween(
    lane,
    "const mobileAccountReviewTargetBySection",
    "};"
  );
  const mappingLiterals = new Set(
    extractStringLiterals(mapping).filter((literal) =>
      literal.startsWith("linked-")
    )
  );
  expect(mappingLiterals).toEqual(
    new Set([
      "linked-reservations-mobile",
      "linked-billing-mobile",
      "linked-danger-mobile",
    ])
  );
  expect(countOccurrences(mapping, "profile: undefined")).toBe(1);
  expect(countOccurrences(mapping, "legal: undefined")).toBe(1);
});
