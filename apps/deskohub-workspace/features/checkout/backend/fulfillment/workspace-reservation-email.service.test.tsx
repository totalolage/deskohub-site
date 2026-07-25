import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { Customer } from "@deskohub/dotypos/generated";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";

mock.module("server-only", () => ({}));

const customer: Customer = {
  _cloudId: "customer-id",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: null,
  email: "customer@example.com",
  phone: null,
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};

const makeReservation = (
  overrides: Partial<WorkspaceReservationDetails>
): WorkspaceReservationDetails => ({
  id: "reservation-id",
  dotyposCustomerId: "dotypos-customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  customerAccessCode: "1234",
  reservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  locale: "en-US",
  customer,
  reservedFrom: Temporal.Instant.from("2026-06-12T07:00:00Z"),
  reservedUntil: Temporal.Instant.from("2026-06-12T11:00:00Z"),
  ...overrides,
});

describe("workspace reservation email details", () => {
  test("renders Basic cowork details without meeting-room-only rows", async () => {
    const { createReservationRows } = await import(
      "./workspace-reservation-email.service"
    );
    const rows = createReservationRows(makeReservation({}), "en-US");

    expect(rows).toEqual([
      ["Entry tier", "Basic Day Pass"],
      ["Reservation date", "Friday, June 12, 2026"],
      ["Coffee", "No"],
      ["Reservation reference", "dotypos-reservation-id"],
      ["Order reference", "reservation-id"],
    ]);
  });

  test("renders Profi cowork monitor details", async () => {
    const { createReservationRows } = await import(
      "./workspace-reservation-email.service"
    );
    const rows = createReservationRows(
      makeReservation({
        reservationDetails: {
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
          monitorOption: "2x27-qhd",
        },
      }),
      "en-US"
    );

    expect(rows).toEqual([
      ["Entry tier", "Profi Workstation"],
      ["Reservation date", "Friday, June 12, 2026"],
      ["Coffee", "Yes"],
      ["Monitors", "2x 27 QHD"],
      ["Reservation reference", "dotypos-reservation-id"],
      ["Order reference", "reservation-id"],
    ]);
  });

  test("renders the Dotypos meeting-room interval without cowork details", async () => {
    const {
      createReservationRows,
      createWorkspaceReservationNotificationEmailPreviewHtml,
    } = await import("./workspace-reservation-email.service");
    const reservation = makeReservation({
      reservationDetails: { kind: "meeting-room" },
    });

    expect(createReservationRows(reservation, "en-US")).toEqual([
      ["Reservation", "Meeting Room"],
      ["Reservation date", "Friday, June 12, 2026"],
      ["Reservation time", "9:00 AM – 1:00 PM"],
      ["Reservation reference", "dotypos-reservation-id"],
      ["Order reference", "reservation-id"],
    ]);

    const internalHtml = createWorkspaceReservationNotificationEmailPreviewHtml(
      { reservation }
    );

    expect(internalHtml).toContain("Zasedací místnost");
    expect(internalHtml).toContain("9:00–13:00");
    expect(internalHtml).not.toContain("Káva");
    expect(internalHtml).not.toContain("Monitory");
  });
});
