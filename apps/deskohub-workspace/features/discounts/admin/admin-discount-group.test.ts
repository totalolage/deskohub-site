import { describe, expect, test } from "bun:test";
import type { DiscountGroup } from "@deskohub/dotypos/generated";
import {
  isAssignableDotyposDiscountGroup,
  toAdminDiscountGroup,
} from "./admin-discount-group";

const group = (overrides: Partial<DiscountGroup> = {}): DiscountGroup => ({
  id: " 42 ",
  name: " Members ",
  discountPercent: "12.5",
  deleted: false,
  display: true,
  ...overrides,
});

describe("Dotypos discount groups in the administration", () => {
  test("lists an assignable group by its trimmed ID and name with exact basis points", () => {
    expect(toAdminDiscountGroup(group())).toEqual([
      { id: "42", name: "Members", basisPoints: 1250 },
    ]);
  });

  test("names a group without a name by its ID", () => {
    expect(toAdminDiscountGroup(group({ name: "  " }))).toEqual([
      { id: "42", name: "42", basisPoints: 1250 },
    ]);
    expect(toAdminDiscountGroup(group({ name: null }))).toEqual([
      { id: "42", name: "42", basisPoints: 1250 },
    ]);
  });

  test("omits a group without an ID, a deleted or hidden group, and an inexact percentage", () => {
    for (const unlisted of [
      group({ id: undefined }),
      group({ id: "  " }),
      group({ deleted: true }),
      group({ display: false }),
      group({ discountPercent: null }),
      group({ discountPercent: "12.345" }),
    ]) {
      expect(toAdminDiscountGroup(unlisted)).toEqual([]);
    }
  });

  test("treats a group with no display flag as shown", () => {
    expect(
      isAssignableDotyposDiscountGroup({
        deleted: undefined,
        display: undefined,
      })
    ).toBe(true);
    expect(isAssignableDotyposDiscountGroup({ display: false })).toBe(false);
    expect(isAssignableDotyposDiscountGroup({ deleted: true })).toBe(false);
  });
});
