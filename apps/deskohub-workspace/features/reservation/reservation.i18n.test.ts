import { describe, expect, test } from "bun:test";
import { m } from "@/features/i18n";
import {
  getReservationAvailabilityUnavailableMessage,
  getReservationCheckoutAvailability,
} from "./reservation.i18n";

describe("getReservationCheckoutAvailability", () => {
  const locale = "en-US";

  test.each([
    { kind: "meeting-room" },
    { kind: "office" },
    { kind: "cowork", entryTier: "reserved-desk" },
  ] as const)(
    "prefers the $kind unavailable message over an availability error",
    (reservation) => {
      const unavailable = { date: "2099-06-10", reservation };

      expect(
        getReservationCheckoutAvailability({
          isError: true,
          isPending: false,
          locale,
          unavailable,
        })
      ).toEqual({
        isPending: false,
        unavailableMessage: getReservationAvailabilityUnavailableMessage({
          ...unavailable,
          locale,
        }),
      });
    }
  );

  test("reports a failed check with the availability error", () => {
    expect(
      getReservationCheckoutAvailability({
        isError: true,
        isPending: true,
        locale,
      })
    ).toEqual({
      isPending: true,
      unavailableMessage: m.reservationAvailabilityError({}, { locale }),
    });
  });

  test("leaves an available or still pending selection without a message", () => {
    expect(
      getReservationCheckoutAvailability({
        isError: false,
        isPending: true,
        locale,
      })
    ).toEqual({ isPending: true, unavailableMessage: undefined });
  });
});
