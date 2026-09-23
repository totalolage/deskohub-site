import { expect, test } from "bun:test";

/**
 * The serial account lane is the only runner that captures the authenticated
 * linked-section review targets. These assertions pin the wiring in the lane
 * source so a mobile linked-section capture can never silently disappear from
 * the deployed run without breaking a test.
 */
test("wires mobile linked-section captures after the desktop captures", async () => {
  const lane = await Bun.file(
    new URL("./account-lane.pw.ts", import.meta.url)
  ).text();

  const layoutStepAt = lane.indexOf('id: "checks account layout navigation"');
  const marketingStepAt = lane.indexOf(
    'id: "checks account marketing preferences"',
    layoutStepAt
  );
  expect(layoutStepAt).toBeGreaterThan(-1);
  expect(marketingStepAt).toBeGreaterThan(layoutStepAt);

  // Isolate the section-capture callback handed to the layout-navigation flow.
  const callbackStartAt = lane.indexOf(
    "verifyAccountLayoutNavigation(page, async (section) => {"
  );
  expect(callbackStartAt).toBeGreaterThan(-1);
  expect(callbackStartAt).toBeLessThan(marketingStepAt);
  const callbackEndAt = lane.indexOf("}),", callbackStartAt);
  expect(callbackEndAt).toBeGreaterThan(callbackStartAt);
  const callback = lane.slice(callbackStartAt, callbackEndAt);

  // The awaited desktop capture precedes the awaited conditional mobile
  // capture, and the mobile call is a real captureAccountReview invocation of
  // the mobile target inside the same callback block.
  const desktopAwaitAt = callback.indexOf("await captureAccountReview(");
  const desktopTargetAt = callback.indexOf(
    "accountReviewTargetBySection[section]"
  );
  const mobileLookupAt = callback.indexOf(
    "mobileAccountReviewTargetBySection[section]"
  );
  const mobileGuardAt = callback.indexOf("if (mobileTarget)");
  const mobileAwaitAt = callback.indexOf(
    "await captureAccountReview(",
    mobileGuardAt
  );
  const mobileArgumentAt = callback.indexOf("mobileTarget", mobileAwaitAt);
  expect(desktopAwaitAt).toBeGreaterThan(-1);
  expect(desktopTargetAt).toBeGreaterThan(desktopAwaitAt);
  expect(mobileLookupAt).toBeGreaterThan(desktopTargetAt);
  expect(mobileGuardAt).toBeGreaterThan(mobileLookupAt);
  expect(mobileAwaitAt).toBeGreaterThan(mobileGuardAt);
  expect(mobileArgumentAt).toBeGreaterThan(mobileAwaitAt);

  // Pin the five-entry mobile mapping: only reservations, billing, and danger
  // gain a mobile capture; profile and legal stay desktop-only.
  const mappingStartAt = lane.indexOf(
    "const mobileAccountReviewTargetBySection"
  );
  expect(mappingStartAt).toBeGreaterThan(-1);
  const mappingEndAt = lane.indexOf("};", mappingStartAt);
  expect(mappingEndAt).toBeGreaterThan(mappingStartAt);
  const mapping = lane.slice(mappingStartAt, mappingEndAt);
  expect(mapping).toContain('reservations: "linked-reservations-mobile"');
  expect(mapping).toContain('billing: "linked-billing-mobile"');
  expect(mapping).toContain('danger: "linked-danger-mobile"');
  expect(mapping).toContain("profile: undefined");
  expect(mapping).toContain("legal: undefined");
  expect(mapping).not.toContain("linked-profile-mobile");
  expect(mapping).not.toContain("linked-legal-mobile");
});
