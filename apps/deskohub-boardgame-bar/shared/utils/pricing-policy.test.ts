import { describe, expect, test } from "bun:test";
import {
  ENTRANCE_FEE_TIERS_START_AT,
  ENTRANCE_FEE_TIERS_VISIBLE_AT,
  formatEntranceFeeTiersStartDate,
  getEntranceFeeTiersPhase,
} from "./pricing-policy";

test("formats the tiers start date as the local calendar day in every locale", () => {
  expect(formatEntranceFeeTiersStartDate("en-US")).toBe("January 1, 2027");
  expect(formatEntranceFeeTiersStartDate("cs-CZ")).toBe("1. ledna 2027");
});

describe("getEntranceFeeTiersPhase", () => {
  test("keeps current pricing until the tiers become visible", () => {
    expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_VISIBLE_AT - 1)).toBe(
      "current"
    );
  });

  test("announces the tiers from the visible moment until they start", () => {
    expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_VISIBLE_AT)).toBe(
      "announced"
    );
    expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_START_AT - 1)).toBe(
      "announced"
    );
  });

  test("activates the tiers from the start moment", () => {
    expect(getEntranceFeeTiersPhase(ENTRANCE_FEE_TIERS_START_AT)).toBe(
      "active"
    );
  });
});
