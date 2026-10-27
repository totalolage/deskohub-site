import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type { CheckoutMeetingRoomStatusSummary } from "@/features/checkout/backend/checkout";
import { m } from "@/features/i18n";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import { getMeetingRoomCheckoutStatusSummary } from "./meeting-room-checkout-status-summary";

const setupLabel = m.checkoutStatusSummarySetupLabel({}, { locale: "en-US" });
const timeLabel = m.checkoutStatusSummaryTimeLabel({}, { locale: "en-US" });

const summary: CheckoutMeetingRoomStatusSummary = {
  kind: "meeting-room",
  reservedFrom: Temporal.Instant.from("2026-06-20T08:00:00Z"),
  reservedUntil: Temporal.Instant.from("2026-06-20T09:00:00Z"),
  price: { value: 45_000, exponent: 2, currency: "CZK" },
};

const rowValue = (
  rows: ReturnType<typeof getMeetingRoomCheckoutStatusSummary>["rows"],
  label: string
) => rows.find((row) => row.label === label)?.value;

describe("meeting-room checkout status summary", () => {
  test("shows the booked time and the setup start of an early-setup booking", () => {
    const { rows } = getMeetingRoomCheckoutStatusSummary(
      {
        ...summary,
        earlySetup: true,
        setupFrom: Temporal.Instant.from("2026-06-20T07:45:00Z"),
      },
      "en-US"
    );

    expect(rowValue(rows, timeLabel)).toMatch(/10:00.*11:00 AM/);
    expect(rowValue(rows, setupLabel)).toBe("9:45 AM");
  });

  test("shows no setup row without early setup", () => {
    const { rows } = getMeetingRoomCheckoutStatusSummary(summary, "en-US");

    expect(rows.map(({ label }) => label)).not.toContain(setupLabel);
  });

  test("dates a setup start on the day before a booking from midnight", () => {
    const setupFrom = Temporal.Instant.from("2026-06-19T21:45:00Z");
    const { rows } = getMeetingRoomCheckoutStatusSummary(
      {
        ...summary,
        earlySetup: true,
        reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00Z"),
        reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00Z"),
        setupFrom,
      },
      "en-US"
    );

    expect(rowValue(rows, setupLabel)).toBe(
      formatReservationDisplayDateTime(setupFrom, "en-US")
    );
  });
});
