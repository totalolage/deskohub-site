import { describe, expect, test } from "bun:test";
import {
  getReservationAnalyticsProperties,
  reservationAvailabilityResults,
  reservationPrePaymentOutcomes,
} from "./reservation-analytics";

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

  test("keeps availability and pre-payment outcomes bounded", () => {
    expect(reservationAvailabilityResults).toEqual([
      "available",
      "unavailable",
    ]);
    expect(reservationPrePaymentOutcomes).toEqual([
      "validation",
      "availability_changed",
      "pricing_changed",
      "discount_rejected",
      "reservation_conflict",
      "server_error",
      "transport_error",
      "prepared",
    ]);
  });
});
