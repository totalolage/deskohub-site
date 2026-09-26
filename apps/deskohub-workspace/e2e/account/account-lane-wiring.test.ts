import { expect, test } from "bun:test";
import type { TSESTree } from "@typescript-eslint/types";
import {
  awaitedCallsInOrder,
  callsNamed,
  containsNode,
  identifierNames,
  nodesOf,
  parseTrackedSource,
  positionDelta,
  propertyAssignments,
  stringLiterals,
  topLevelConstInitializer,
} from "@/scripts/shared/source-ast";
import {
  accountReviewTargetBySection,
  mobileAccountReviewTargetBySection,
} from "./review-targets";

const lane = parseTrackedSource(
  new URL("./account-lane.pw.ts", import.meta.url).pathname
);

const findStringLiteral = (value: string): TSESTree.Literal | undefined =>
  stringLiterals(lane.ast).find((literal) => literal.value === value)?.node;

/**
 * The step object literal `{ id: "<stepId>", ... }` declared in the lane
 * source, or undefined when the wiring disappeared.
 */
const stepObjectById = (
  stepId: string
): TSESTree.ObjectExpression | undefined =>
  nodesOf(lane.ast).find((node): node is TSESTree.ObjectExpression => {
    if (node.type !== "ObjectExpression") return false;
    const properties = propertyAssignments(node);
    const id = properties.get("id");
    return (
      id !== undefined &&
      id.value.type === "Literal" &&
      id.value.value === stepId
    );
  });

/**
 * The serial account lane is the only runner that captures the authenticated
 * linked-section review targets. These verdicts pin the wiring in the lane
 * syntax tree so a mobile linked-section capture can never silently
 * disappear from the deployed run without breaking a test.
 */
test("wires mobile linked-section captures after the desktop captures", () => {
  // Step identifiers must exist and appear in this deployed order.
  const layoutStep = stepObjectById("checks account layout navigation");
  const marketingStep = stepObjectById("checks account marketing preferences");
  expect(layoutStep).toBeDefined();
  expect(marketingStep).toBeDefined();
  expect(positionDelta(layoutStep!, marketingStep!)).toBeLessThan(0);

  // The section-capture callback handed to the layout-navigation flow is the
  // arrow function argument of verifyAccountLayoutNavigation: exactly two
  // awaited captureAccountReview calls, the desktop target first, then the
  // conditional mobile target behind its guard.
  const verifyCall = callsNamed(lane.ast, "verifyAccountLayoutNavigation");
  expect(verifyCall).toHaveLength(1);
  const callback = verifyCall[0]?.arguments.find(
    (argument): argument is TSESTree.ArrowFunctionExpression =>
      argument.type === "ArrowFunctionExpression"
  );
  expect(callback).toBeDefined();

  const captures = awaitedCallsInOrder(callback!, "captureAccountReview");
  expect(captures).toHaveLength(2);

  const [desktopCapture, mobileCapture] = captures;
  // Desktop capture target: accountReviewTargetBySection[section]
  expect(
    desktopCapture?.arguments.some(
      (argument) =>
        argument.type === "MemberExpression" &&
        argument.object.type === "Identifier" &&
        argument.object.name === "accountReviewTargetBySection"
    )
  ).toBe(true);
  // The mobile target is read into a variable before the guard, and the
  // guarded second capture passes that same variable.
  const mobileTargetLookup = nodesOf(callback!).find(
    (node): node is TSESTree.VariableDeclarator =>
      node.type === "VariableDeclarator" &&
      node.init?.type === "MemberExpression" &&
      node.init.object.type === "Identifier" &&
      node.init.object.name === "mobileAccountReviewTargetBySection"
  );
  expect(mobileTargetLookup).toBeDefined();
  const mobileTargetName =
    mobileTargetLookup?.id.type === "Identifier"
      ? mobileTargetLookup.id.name
      : undefined;
  expect(mobileTargetName).toBeDefined();
  // The second awaited capture sits inside the `if (mobileTarget)` guard.
  const guard = nodesOf(callback!).find(
    (node): node is TSESTree.IfStatement =>
      node.type === "IfStatement" &&
      node.test.type === "Identifier" &&
      node.test.name === mobileTargetName
  );
  expect(guard).toBeDefined();
  expect(containsNode(guard!, mobileCapture!)).toBe(true);
  expect(positionDelta(desktopCapture!, mobileCapture!)).toBeLessThan(0);
});

test("pins the five-entry mobile review mapping to the linked sections", () => {
  // Only reservations, billing, and danger gain a mobile capture; profile
  // and legal stay desktop-only. Verdicts come from the shared runtime data
  // the lane itself consumes.
  expect(mobileAccountReviewTargetBySection).toEqual({
    reservations: "linked-reservations-mobile",
    billing: "linked-billing-mobile",
    danger: "linked-danger-mobile",
    profile: undefined,
    legal: undefined,
  });
  expect(Object.keys(mobileAccountReviewTargetBySection).sort()).toEqual(
    Object.keys(accountReviewTargetBySection).sort()
  );
});

test("maps the case-level review targets through the shared lane data", () => {
  // The lane reads its per-case capture target from the same shared map, so
  // the deployed wiring cannot drift from the pinned values.
  const importedMap = topLevelConstInitializer(
    lane.ast,
    "accountReviewTargetByCaseId"
  );
  expect(importedMap).toBeUndefined();
  const identifiers = identifierNames(lane.ast);
  expect(identifiers.has("accountReviewTargetByCaseId")).toBe(true);
  expect(identifiers.has("accountReviewTargetBySection")).toBe(true);
  expect(identifiers.has("mobileAccountReviewTargetBySection")).toBe(true);

  // No stale inline mapping literals remain in the lane source.
  for (const target of [
    "linked-reservations-desktop",
    "linked-danger-mobile",
    "sign-in-accepted-desktop",
  ]) {
    expect(stringLiterals(lane.ast).map((l) => l.value)).not.toContain(target);
  }
});
