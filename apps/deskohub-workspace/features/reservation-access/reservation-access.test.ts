import { describe, expect, test } from "bun:test";
import { getReservationAccessName } from "./reservation-access";

describe("getReservationAccessName", () => {
  test("returns the stored name of a grant's Igloohome credential", () => {
    expect(
      getReservationAccessName({
        reservationId: "reservation-1",
        accessName: "Deskohub stored-name",
      })
    ).toBe("Deskohub stored-name");
  });

  test("names a grant created before names were stored by its reservation within Igloohome's limit", () => {
    const reservationId = `reservation-${"x".repeat(80)}`;

    expect(getReservationAccessName({ reservationId, accessName: null })).toBe(
      `Deskohub ${reservationId}`.slice(0, 60)
    );
  });
});
