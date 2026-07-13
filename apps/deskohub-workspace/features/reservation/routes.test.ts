import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  coworkReservationPath,
  getCoworkReservationPath,
  getMeetingRoomReservationPath,
  getReservationStartPath,
  meetingRoomReservationPath,
  reservationStatusPath,
} from "./routes";

const appRouteExists = (path: string) =>
  existsSync(fileURLToPath(new URL(`../../app/${path}`, import.meta.url)));

describe("reservation routes", () => {
  test("builds the localized reservation entry paths", () => {
    expect(coworkReservationPath).toBe("/reservation/cowork");
    expect(meetingRoomReservationPath).toBe("/reservation/meeting-room");
    expect(reservationStatusPath).toBe("/reservation/status");
    expect(getCoworkReservationPath("en-US")).toBe("/en-US/reservation/cowork");
    expect(getMeetingRoomReservationPath("cs-CZ")).toBe(
      "/cs-CZ/reservation/meeting-room"
    );
    expect(getReservationStartPath("en-US", "cowork")).toBe(
      "/en-US/reservation/cowork"
    );
    expect(
      getReservationStartPath(
        "en-US",
        "cowork",
        new URLSearchParams({ payState: "signed-state" })
      )
    ).toBe("/en-US/reservation/cowork?payState=signed-state");
    expect(getReservationStartPath("cs-CZ", "meeting-room")).toBe(
      "/cs-CZ/reservation/meeting-room"
    );
    expect(
      getReservationStartPath(
        "cs-CZ",
        "meeting-room",
        new URLSearchParams({ payState: "signed-state" })
      )
    ).toBe("/cs-CZ/reservation/meeting-room?payState=signed-state");
  });

  test("keeps only the P14 route entries", () => {
    expect(
      appRouteExists("[locale]/(minimal-header)/reservation/cowork/page.tsx")
    ).toBe(true);
    expect(
      appRouteExists(
        "[locale]/(minimal-header)/reservation/meeting-room/page.tsx"
      )
    ).toBe(true);
    expect(
      appRouteExists(
        "[locale]/(minimal-header)/reservation/status/[orderId]/page.tsx"
      )
    ).toBe(true);
    expect(
      appRouteExists(
        "[locale]/(minimal-header)/checkout/pay/return/[orderId]/route.ts"
      )
    ).toBe(true);

    expect(
      appRouteExists("[locale]/(minimal-header)/checkout/order/page.tsx")
    ).toBe(false);
    expect(
      appRouteExists(
        "[locale]/(minimal-header)/checkout/status/[orderId]/page.tsx"
      )
    ).toBe(false);
    expect(
      appRouteExists(
        "[locale]/(minimal-header)/checkout/result/[orderId]/route.ts"
      )
    ).toBe(false);
    expect(
      appRouteExists(
        "[locale]/(minimal-header)/checkout/payment/[orderId]/route.ts"
      )
    ).toBe(false);
  });
});
