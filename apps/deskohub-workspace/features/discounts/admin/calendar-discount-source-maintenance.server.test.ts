import { expect, test } from "bun:test";
import { discountMutationChangesCalendarSource } from "./calendar-discount-source-maintenance.server";

test.each([
  [{ kind: "create-discount" }, true],
  [{ kind: "update-discount" }, true],
  [{ kind: "delete-discount" }, true],
  [{ kind: "create-code", discount: { kind: "new" } }, true],
  [{ kind: "create-customer-code", discount: { kind: "new" } }, true],
  [{ kind: "create-code", discount: { kind: "existing" } }, false],
  [{ kind: "create-voucher" }, false],
] as const)("detects source-changing mutation %#", (mutation, expected) => {
  expect(discountMutationChangesCalendarSource(mutation)).toBe(expected);
});
