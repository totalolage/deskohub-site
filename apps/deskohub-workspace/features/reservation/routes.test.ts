import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  coworkReservationPath,
  getReservationStartPath,
  getShareableReservationStartPath,
  meetingRoomReservationPath,
  officeReservationPath,
  reservationAccessPath,
  reservationInvoicePath,
  reservationStatusPath,
} from "./routes";

const appRouteExists = (path: string) =>
  existsSync(
    fileURLToPath(
      new URL(
        `../../app/[locale]/(site)/(minimal-header)${path}`,
        import.meta.url
      )
    )
  );

describe("reservation routes", () => {
  test("serves every reservation path from an app route", () => {
    for (const path of [
      coworkReservationPath,
      meetingRoomReservationPath,
      officeReservationPath,
    ]) {
      expect(appRouteExists(`${path}/page.tsx`)).toBe(true);
    }
    for (const path of [
      reservationAccessPath,
      reservationInvoicePath,
      reservationStatusPath,
    ]) {
      expect(appRouteExists(`${path}/[orderId]/page.tsx`)).toBe(true);
    }
  });

  test("builds shareable and locale-prefixed reservation start paths", () => {
    const searchParams = new URLSearchParams({ entryTier: "open-space" });

    expect(getShareableReservationStartPath("cowork", searchParams)).toBe(
      "/reservation/cowork?entryTier=open-space"
    );
    expect(getReservationStartPath("cs-CZ", "cowork", searchParams)).toBe(
      "/cs-CZ/reservation/cowork?entryTier=open-space"
    );
  });

  test("leaves off the query delimiter when search params are empty", () => {
    const emptySearchParams = new URLSearchParams();

    expect(
      getShareableReservationStartPath("meeting-room", emptySearchParams)
    ).toBe("/reservation/meeting-room");
    expect(
      getReservationStartPath("cs-CZ", "meeting-room", emptySearchParams)
    ).toBe("/cs-CZ/reservation/meeting-room");
  });
});
