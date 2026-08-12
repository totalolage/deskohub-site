import { describe, expect, test } from "bun:test";
import { getReservationStatusPath } from "./reservation-status-url";

describe("reservation status URL", () => {
  test("builds the localized status path", () => {
    expect(
      getReservationStatusPath({
        locale: "en-US",
        orderId: "reservation-id",
        outcome: "success",
      })
    ).toBe("/en-US/reservation/status/reservation-id?outcome=success");
  });

  test("omits an unknown return outcome", () => {
    expect(
      getReservationStatusPath({
        locale: "cs-CZ",
        orderId: "reservation-id",
        outcome: "unknown",
      })
    ).toBe("/cs-CZ/reservation/status/reservation-id");
  });

  test("adds the protected customer status capability", () => {
    expect(
      getReservationStatusPath({
        locale: "en-US",
        orderId: "reservation-id",
        statusToken: "signed-status-token",
        skipPreviewProtectionBypass: true,
      })
    ).toBe(
      "/en-US/reservation/status/reservation-id?statusToken=signed-status-token"
    );
  });
});
