import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { getWorkspaceProductByTier } from "../../features/checkout/product-catalog";
import {
  callsNamed,
  identifierNames,
  methodCallsNamed,
  nodesOf,
  parseTrackedSource,
  propertyAssignments,
  stringLiterals,
} from "../../scripts/shared/source-ast";
import { calendarDiscountExpectation } from "../cases/discounts";
import { discountCodeFixtures } from "./discount-fixtures";

const parseFixtureModule = () =>
  parseTrackedSource(
    fileURLToPath(new URL("./discount-fixtures.ts", import.meta.url))
  );

test("expires a code beyond cross-host clock skew", () => {
  const { ast } = parseFixtureModule();

  // The pinned expiry is one fixed instant, never a wall-clock subtraction.
  const fixedInstants = methodCallsNamed(ast, "from").filter(
    (call) =>
      call.callee.type === "MemberExpression" &&
      call.callee.object.type === "MemberExpression" &&
      call.callee.object.object.type === "Identifier" &&
      call.callee.object.object.name === "Temporal" &&
      stringLiterals(call).some(
        (literal) => literal.value === "2000-01-01T00:00:00Z"
      )
  );
  expect(fixedInstants).toHaveLength(1);
  const nowSubtractions = callsNamed(ast, "subtract").filter((call) =>
    identifierNames(call).has("instant")
  );
  expect(nowSubtractions).toHaveLength(0);
});

test("toggles only the transient Calendar target idempotently", () => {
  const { ast } = parseFixtureModule();

  expect(methodCallsNamed(ast, "onConflictDoNothing").length).toBeGreaterThan(
    0
  );
  expect(
    callsNamed(ast, "eq").filter(
      (call) =>
        call.arguments[0]?.type === "MemberExpression" &&
        !call.arguments[0].computed &&
        call.arguments[0].object.type === "Identifier" &&
        call.arguments[0].object.name === "discountProductTargets" &&
        call.arguments[0].property.type === "Identifier" &&
        call.arguments[0].property.name === "productTarget" &&
        call.arguments[1]?.type === "Identifier" &&
        call.arguments[1].name === "product"
    ).length
  ).toBeGreaterThan(0);
  // The toggle must not run a CTE delete.
  expect(
    stringLiterals(ast).some((literal) =>
      literal.value.includes("with removed as (")
    )
  ).toBe(false);
});

test("targets the zero-total fixture at the meeting-room family", () => {
  const { ast } = parseFixtureModule();

  const kindValues = nodesOf(ast).flatMap((node) => {
    if (node.type !== "ObjectExpression") return [];
    const kind = propertyAssignments(node).get("kind");
    if (kind?.value.type !== "Literal") return [];
    return [kind.value.value];
  });
  expect(kindValues).toContain("meeting-room");
});

test("voucher credit covers two one-day Open Space checkouts after the Calendar sale", () => {
  const openSpacePrice = getWorkspaceProductByTier("open-space").price.value;
  const calendarSaleBasisPoints =
    calendarDiscountExpectation.adjustment.basisPoints;

  const perDateAfterSale =
    openSpacePrice -
    Math.floor((openSpacePrice * calendarSaleBasisPoints) / 10_000);
  expect(perDateAfterSale).toBe(
    Math.floor((openSpacePrice * (10_000 - calendarSaleBasisPoints)) / 10_000)
  );

  const expectedTwoDateTotal = perDateAfterSale * 2;
  expect(discountCodeFixtures.voucherReuse.creditPerRun.value).toBe(
    expectedTwoDateTotal
  );
});
