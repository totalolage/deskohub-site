import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  coworkReservationPath,
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
});
