import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  getReservationAccessName,
  reservationAccessGrantIdSchema,
  reservationAccessGrantStates,
} from "./reservation-access";

const grantId = Schema.decodeUnknownSync(reservationAccessGrantIdSchema)(
  "019a0000-0000-7000-8000-000000000001"
);

describe("getReservationAccessName", () => {
  test.each(reservationAccessGrantStates)(
    "returns the stored name of a %s grant's latest Igloohome request",
    (state) => {
      expect(
        getReservationAccessName({
          id: grantId,
          reservationId: "reservation-1",
          state,
          accessName: "Deskohub stored-name",
        })
      ).toBe("Deskohub stored-name");
    }
  );

  test("names a grant without a request by its ID within Igloohome's limit", () => {
    const accessName = getReservationAccessName({
      id: grantId,
      reservationId: "reservation-1",
      state: "pending",
      accessName: null,
    });

    expect(accessName).toBe(`Deskohub ${grantId}`);
    expect(accessName.length).toBeLessThanOrEqual(60);
  });

  test.each(
    reservationAccessGrantStates.filter((state) => state !== "pending")
  )(
    "names a %s grant requested without a stored name by its reservation",
    (state) => {
      expect(
        getReservationAccessName({
          id: grantId,
          reservationId: `reservation-${"x".repeat(80)}`,
          state,
          accessName: null,
        })
      ).toBe(`Deskohub reservation-${"x".repeat(80)}`.slice(0, 60));
    }
  );
});
