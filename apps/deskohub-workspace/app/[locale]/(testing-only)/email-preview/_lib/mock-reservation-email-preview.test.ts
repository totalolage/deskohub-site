import { expect, test } from "bun:test";
import { createWorkspaceReservationEmailPreviewReservation } from "./mock-reservation-email-preview";

test("loads the reservation fixture without application instrumentation", () => {
  const reservation = createWorkspaceReservationEmailPreviewReservation("en");

  expect(reservation.reservedFrom.toString()).toBe("2026-06-12T07:00:00Z");
  expect(reservation.reservedUntil.toString()).toBe("2026-06-13T07:00:00Z");
});
