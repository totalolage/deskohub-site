import { expect, test } from "bun:test";
import {
  createWorkspaceOpenSpaceReservationEmailPreviewReservation,
  createWorkspaceReservationEmailPreviewReservation,
} from "./mock-reservation-email-preview";

test("loads the reservation fixture without application instrumentation", () => {
  const reservation = createWorkspaceReservationEmailPreviewReservation("en");

  expect(reservation.reservedFrom.toString()).toBe("2026-06-12T07:00:00Z");
  expect(reservation.reservedUntil.toString()).toBe("2026-06-13T07:00:00Z");
});

test("customer reservation preview uses Open Space names instead of its assigned table", () => {
  const reservation =
    createWorkspaceOpenSpaceReservationEmailPreviewReservation("en-US");

  expect(reservation.reservationDetails).toEqual({
    kind: "cowork",
    entryTier: "open-space",
    coffee: false,
  });
  expect(reservation.openSpaceTableNames).toEqual([
    "9",
    "10",
    "11",
    "12",
    "15",
    "16",
    "wallee",
    "gromice",
  ]);
  expect(reservation.tableName).toBe("assigned-only-preview-table-id");
});
