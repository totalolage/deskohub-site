import { expect, test } from "bun:test";
import { formatDate } from "./date-formatting";
import {
  ENTRANCE_FEE_TIERS_START_AT,
  ENTRANCE_FEE_TIERS_VISIBLE_AT,
  formatEntranceFeeTiersStartDate,
  getEntranceFeeTiersPhase,
} from "./pricing-policy";

test("keeps the current pricing quote before the announcement", () => {
  expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_VISIBLE_AT - 1)).toBe(
    "current"
  );
});

test("announces the tiers alongside the current pricing during the announcement month", () => {
  expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_VISIBLE_AT)).toBe(
    "announced"
  );
  expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_START_AT - 1)).toBe(
    "announced"
  );
});

test("quotes only the tiers once they take effect", () => {
  expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_START_AT)).toBe("active");
});

test("formats the production tiers start date for every locale", () => {
  const productionStart = Date.UTC(2026, 11, 31, 23);
  expect(
    formatDate(new Date(productionStart), "en-US", { dateStyle: "long" })
  ).toBe("January 1, 2027");
  expect(
    formatDate(new Date(productionStart), "cs-CZ", { dateStyle: "long" })
  ).toBe("1. ledna 2027");
});

test("formats the configured tiers start date for every locale", () => {
  const expected = (locale: string) =>
    formatDate(new Date(ENTRANCE_FEE_TIERS_START_AT), locale, {
      dateStyle: "long",
    });

  expect(formatEntranceFeeTiersStartDate("en-US")).toBe(expected("en-US"));
  expect(formatEntranceFeeTiersStartDate("cs-CZ")).toBe(expected("cs-CZ"));
});
