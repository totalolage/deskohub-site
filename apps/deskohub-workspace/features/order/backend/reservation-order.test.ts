import type { TSESTree } from "@typescript-eslint/types";
import { expect, test } from "bun:test";
import {
  identifierNames,
  methodCallsNamed,
  nodesOf,
  parseTrackedSource,
  propertyAssignments,
  stringLiterals,
  topLevelConstInitializer,
} from "../../../scripts/shared/source-ast";

const { ast } = parseTrackedSource(
  new URL("./reservation-order.ts", import.meta.url).pathname
);

const mirrorInitializer = topLevelConstInitializer(
  ast,
  "ensureReservationOrder"
);
const mirrorNodes =
  mirrorInitializer === undefined ? [] : nodesOf(mirrorInitializer);

/** `input.reservation.<field>` mirrored-column assignments, keyed by field. */
const mirroredFields = new Map<string, TSESTree.Property>();
for (const node of mirrorNodes) {
  if (
    node.type !== "Property" ||
    node.key.type !== "Identifier" ||
    node.value.type !== "MemberExpression" ||
    node.value.computed ||
    node.value.property.type !== "Identifier"
  ) {
    continue;
  }
  const object = node.value.object;
  if (
    object.type === "MemberExpression" &&
    !object.computed &&
    object.object.type === "Identifier" &&
    object.object.name === "input" &&
    object.property.type === "Identifier" &&
    object.property.name === "reservation" &&
    node.value.property.name === node.key.name
  ) {
    mirroredFields.set(node.key.name, node);
  }
}

test("mirrors reservation facts into the reservation-kind order upsert", () => {
  expect(mirrorInitializer).toBeDefined();

  // The mirror persists through a single upsert on the reservation-kind
  // order row: one onConflictDoUpdate keyed by orders.id whose setWhere
  // clause never revives an order of another kind.
  const upserts = methodCallsNamed(mirrorInitializer!, "onConflictDoUpdate");
  expect(upserts).toHaveLength(1);
  const upsertConfig = upserts[0]!.arguments[0];
  expect(upsertConfig?.type).toBe("ObjectExpression");
  const upsertProperties = propertyAssignments(
    upsertConfig as TSESTree.ObjectExpression
  );
  expect([...upsertProperties.keys()].sort()).toEqual([
    "set",
    "setWhere",
    "target",
  ]);
  const kindLiterals = stringLiterals(mirrorInitializer!).map(
    ({ value }) => value
  );
  expect(kindLiterals).toContain("reservation");

  // Every mirrored column is overwritten with the reservation's own fact.
  const mirroredColumnNames = [
    "correlationId",
    "dotyposCustomerId",
    "paymentState",
    "fulfillmentState",
    "activePaymentAttemptId",
    "paidAt",
    "fulfilledAt",
    "fulfillmentFailedAt",
    "fulfillmentFailureCode",
    "createdAt",
    "updatedAt",
  ];
  for (const field of mirroredColumnNames) {
    expect(mirroredFields.has(field)).toBe(true);
  }

  // Lock-order contract: the mirror is reservation → order only. It must
  // never touch payment_attempts (attempt relink belongs to the
  // attempt-first payment writers), or reservation-first callers would
  // invert the rolling-deploy lock order.
  const referencedNames = identifierNames(mirrorInitializer!);
  expect(referencedNames.has("paymentAttempts")).toBe(false);
  expect(methodCallsNamed(mirrorInitializer!, "isNull")).toHaveLength(0);
  expect(referencedNames.has("isNull")).toBe(false);
});
