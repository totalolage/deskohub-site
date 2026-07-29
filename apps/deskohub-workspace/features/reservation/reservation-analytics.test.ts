import { describe, expect, test } from "bun:test";
import { getReservationAnalyticsProperties } from "./reservation-analytics";

describe("getReservationAnalyticsProperties", () => {
  test("preserves sale-banner attribution for checkout analytics", () => {
    expect(
      getReservationAnalyticsProperties(
        new URLSearchParams({
          utm_source: "deskohub",
          utm_medium: "sale_banner",
          utm_content: "home_hero",
        })
      )
    ).toEqual({
      utm_source: "deskohub",
      utm_medium: "sale_banner",
      utm_content: "home_hero",
    });
  });
});
