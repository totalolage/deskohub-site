import { describe, expect, test } from "bun:test";
import {
  discountProductTargetOptions,
  formatDiscountProductTargets,
  getDiscountProductTargetLabel,
} from "./product-target-options";

describe("discount product target labels", () => {
  test("name each cowork tier with its catalog title in the route locale", () => {
    const labels = (locale: "cs-CZ" | "en-US") =>
      discountProductTargetOptions.map(({ target }) =>
        getDiscountProductTargetLabel(target, locale)
      );

    expect(labels("en-US")).toEqual([
      "All cowork tiers",
      "Open Space only",
      "Reserved Desk only",
      "Meeting room",
      "Private office",
    ]);
    expect(labels("cs-CZ")).toEqual([
      "Všechny úrovně coworku",
      "Pouze Sdílené místo",
      "Pouze Vyhrazené místo",
      "Zasedačka",
      "Soukromá kancelář",
    ]);
  });

  test("join a product summary in the route locale", () => {
    expect(
      formatDiscountProductTargets(
        [{ kind: "cowork", tier: "reserved-desk" }, { kind: "meeting-room" }],
        "cs-CZ"
      )
    ).toBe("Pouze Vyhrazené místo, Zasedačka");
  });
});
