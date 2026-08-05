import { describe, expect, test } from "bun:test";
import { getUniqueReservationId } from "./reservation-lookup.server";

describe("reservation lookup", () => {
  test("returns the reservation when several associated IDs converge on it", () => {
    expect(
      getUniqueReservationId([
        "reservation-1",
        "reservation-1",
        null,
        undefined,
      ])
    ).toBe("reservation-1");
  });

  test("does not guess when an identifier belongs to multiple reservations", () => {
    expect(
      getUniqueReservationId(["reservation-1", "reservation-2"])
    ).toBeNull();
  });
});
