import { describe, expect, test } from "bun:test";
import {
  getReservationAccessPath,
  getReservationInvoicePath,
} from "./reservation-access-url";

describe("reservation access URL", () => {
  test("builds the localized protected access path", () => {
    expect(
      getReservationAccessPath({
        locale: "en-US",
        orderId: "reservation-id",
        accessToken: "signed-access-token",
      })
    ).toBe(
      "/en-US/reservation/access/reservation-id?accessToken=signed-access-token"
    );
  });

  test("builds the invoice path with the same capability", () => {
    expect(
      getReservationInvoicePath({
        locale: "en-US",
        orderId: "reservation-id",
        accessToken: "signed-access-token",
      })
    ).toBe(
      "/en-US/reservation/invoice/reservation-id?accessToken=signed-access-token"
    );
  });
});
