import { describe, expect, test } from "bun:test";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenSchema } from "@/features/reservation/reservation-access-token";
import {
  getReservationAccessPath,
  getReservationInvoicePath,
} from "./reservation-access-url";

const accessToken = reservationAccessTokenSchema.make("signed-access-token");
const orderId = workspaceReservationIdSchema.make("reservation-id");

describe("reservation access URL", () => {
  test("builds the localized protected access path", () => {
    expect(
      getReservationAccessPath({
        locale: "en-US",
        orderId,
        accessToken,
      })
    ).toBe(
      "/en-US/reservation/access/reservation-id?accessToken=signed-access-token"
    );
  });

  test("builds the invoice path with the same capability", () => {
    expect(
      getReservationInvoicePath({
        locale: "en-US",
        orderId,
        accessToken,
      })
    ).toBe(
      "/en-US/reservation/invoice/reservation-id?accessToken=signed-access-token"
    );
  });
});
