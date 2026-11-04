import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import type { StoredDiscountId } from "@/features/discounts/persistence-contracts";
import {
  findCalendarSaleDiscount,
  getCalendarSaleDiscountLabel,
  getCalendarStatusLabel,
} from "./calendar-sale-display";

const listedDiscountId =
  "019c91dd-c560-7e55-b9d8-c95065efd51d" as StoredDiscountId;
const unlistedDiscountId =
  "019c91dd-c560-7e55-b9d8-c95065efd59d" as StoredDiscountId;
const listedDiscount = {
  labels: { "cs-CZ": "Letní sleva", "en-US": "Summer discount" },
};
const discountsById = new Map([[listedDiscountId, listedDiscount]]);

describe("getCalendarStatusLabel", () => {
  test.each([
    ["confirmed", m.discountsCalendarStatusConfirmed],
    ["tentative", m.discountsCalendarStatusTentative],
    ["cancelled", m.discountsCalendarStatusCancelled],
    ["unknown", m.discountsCalendarStatusUnknown],
  ] as const)("localizes the %s status", (status, message) => {
    expect(getCalendarStatusLabel(status, "cs-CZ")).toBe(
      message({}, { locale: "cs-CZ" })
    );
  });

  test("shows a status Calendar added later as sent", () => {
    expect(getCalendarStatusLabel("rescheduled", "en-US")).toBe("rescheduled");
  });
});

describe("findCalendarSaleDiscount", () => {
  test("finds the listed discount an associated sale points at", () => {
    expect(
      findCalendarSaleDiscount(
        {
          kind: "associated",
          discountId: listedDiscountId,
          discountLabel: "Summer discount",
        },
        discountsById
      )
    ).toBe(listedDiscount);
  });

  test("finds nothing for a discount outside the list", () => {
    expect(
      findCalendarSaleDiscount(
        {
          kind: "associated",
          discountId: unlistedDiscountId,
          discountLabel: "Archived discount",
        },
        discountsById
      )
    ).toBeUndefined();
  });

  test("ignores a missing discount's id even when it is listed", () => {
    expect(
      findCalendarSaleDiscount(
        { kind: "missing-discount", discountId: listedDiscountId },
        discountsById
      )
    ).toBeUndefined();
    expect(
      findCalendarSaleDiscount({ kind: "invalid-description" }, discountsById)
    ).toBeUndefined();
  });
});

describe("getCalendarSaleDiscountLabel", () => {
  test("labels a listed discount in the operator's locale", () => {
    expect(
      getCalendarSaleDiscountLabel(
        {
          kind: "associated",
          discountId: listedDiscountId,
          discountLabel: "Summer discount",
        },
        discountsById,
        "cs-CZ"
      )
    ).toBe("Letní sleva");
  });

  test("falls back to the server's label for a discount outside the list", () => {
    expect(
      getCalendarSaleDiscountLabel(
        {
          kind: "associated",
          discountId: unlistedDiscountId,
          discountLabel: "Archived discount",
        },
        discountsById,
        "cs-CZ"
      )
    ).toBe("Archived discount");
  });
});
