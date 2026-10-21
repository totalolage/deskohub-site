import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  getReservationAccessName,
  reservationAccessGrantIdSchema,
} from "./reservation-access";

const grantId = Schema.decodeUnknownSync(reservationAccessGrantIdSchema)(
  "019a0000-0000-7000-8000-000000000001"
);

describe("getReservationAccessName", () => {
  test("returns the stored name of a grant's latest Igloohome request", () => {
    expect(
      getReservationAccessName({
        id: grantId,
        accessName: "Deskohub reservation-1",
      })
    ).toBe("Deskohub reservation-1");
  });

  test("names a grant without a request by its ID within Igloohome's limit", () => {
    const accessName = getReservationAccessName({
      id: grantId,
      accessName: null,
    });

    expect(accessName).toBe(`Deskohub ${grantId}`);
    expect(accessName.length).toBeLessThanOrEqual(60);
  });
});
