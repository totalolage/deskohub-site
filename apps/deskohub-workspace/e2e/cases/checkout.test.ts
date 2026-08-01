import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type { Customer } from "@deskohub/dotypos/generated";
import { Effect } from "effect";

const customer: Customer = {
  _cloudId: "customer-id",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: null,
  email: "customer@example.com",
  phone: null,
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};

const checkoutRow = {
  dotypos_customer_id: "dotypos-customer-id",
  dotypos_reservation_id: "dotypos-reservation-id",
  locale: "en-US",
  reservation_details: { kind: "meeting-room" },
  reservation_id: "workspace-reservation-id",
} as const;

const wholeDayData = {
  meetingRoom: {
    duration: { unit: "day", amount: 1 },
    startsAt: "2027-03-27T23:00:00Z",
    endsAt: "2027-03-28T22:00:00Z",
    startDateTime: "2027-03-28T00:00",
  },
} as const;

describe("whole-day meeting-room checkout proof", () => {
  test("renders both shared email detail projections from the confirmed DST calendar day", async () => {
    const { assertWholeDayMeetingRoomEmailPreviews } = await import(
      "./checkout"
    );

    await expect(
      Effect.runPromise(
        assertWholeDayMeetingRoomEmailPreviews({
          checkoutRow,
          data: wholeDayData,
          dotyposReservation: {
            customer,
            reservedFrom: Temporal.Instant.from("2027-03-27T23:00:00Z"),
            reservedUntil: Temporal.Instant.from("2027-03-28T22:00:00Z"),
          },
        })
      )
    ).resolves.toBeUndefined();
  });

  test("rejects a confirmed interval that is not one Prague calendar day", async () => {
    const { assertWholeDayMeetingRoomEmailPreviews } = await import(
      "./checkout"
    );

    await expect(
      Effect.runPromise(
        assertWholeDayMeetingRoomEmailPreviews({
          checkoutRow,
          data: wholeDayData,
          dotyposReservation: {
            customer,
            reservedFrom: Temporal.Instant.from("2027-03-28T00:00:00Z"),
            reservedUntil: Temporal.Instant.from("2027-03-29T00:00:00Z"),
          },
        })
      )
    ).rejects.toThrow(
      "confirmed Dotypos reservation is not one Prague calendar day"
    );
  });
});
