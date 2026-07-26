import { expect, test } from "bun:test";
import type { DiscountGroup } from "@deskohub/dotypos/generated";
import { selectE2EDotyposDiscountGroup } from "./dotypos";

test("selects an active partial Dotypos discount deterministically", () => {
  const selected = selectE2EDotyposDiscountGroup([
    { id: "deleted", deleted: true, discountPercent: "5" },
    { id: "full", discountPercent: "100" },
    { id: "malformed", discountPercent: "10.005" },
    { id: "later", discountPercent: "12.5" },
    { id: "second", discountPercent: "7.5" },
    { id: "first", discountPercent: "7.5" },
    { id: "fractional", discountPercent: "0.07" },
  ] satisfies readonly DiscountGroup[]);

  expect(selected).toEqual({ basisPoints: 7, id: "fractional" });
});

test("requires a usable Dotypos customer-discount group", () => {
  expect(() =>
    selectE2EDotyposDiscountGroup([
      { id: "deleted", deleted: true, discountPercent: "10" },
      { id: "full", discountPercent: "100" },
    ])
  ).toThrow(
    "the E2E Dotypos cloud must contain an active percentage discount group from 0.01% through 90%"
  );
});

test("rejects a near-total group that leaves too little for stacked discounts", () => {
  expect(() =>
    selectE2EDotyposDiscountGroup([
      { id: "near-total", discountPercent: "99.99" },
    ])
  ).toThrow(
    "the E2E Dotypos cloud must contain an active percentage discount group from 0.01% through 90%"
  );
});
