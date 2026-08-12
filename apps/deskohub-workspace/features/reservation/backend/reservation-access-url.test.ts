import { describe, expect, test } from "bun:test";
import { getReservationAccessPath } from "./reservation-access-url";

describe("reservation access URL", () => {
  test("builds the localized protected access path", () => {
    expect(
      getReservationAccessPath({
        locale: "en-US",
        orderId: "reservation-id",
        accessToken: "signed-access-token",
        skipPreviewProtectionBypass: true,
      })
    ).toBe(
      "/en-US/reservation/access/reservation-id?accessToken=signed-access-token"
    );
  });
});
