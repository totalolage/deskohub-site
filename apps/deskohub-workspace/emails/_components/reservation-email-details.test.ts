import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import { m } from "@/features/i18n";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  type ReservationEmailReservation,
  reservationEmailDetails,
} from "./reservation-email-details";

const makeReservation = (
  overrides: Partial<ReservationEmailReservation> = {}
): ReservationEmailReservation => ({
  id: workspaceReservationIdSchema.make("reservation-id"),
  dotyposReservationId: DotyposReservationIdSchema.make("dotypos-id"),
  reservationDetails: { kind: "cowork", entryTier: "basic", coffee: false },
  reservedFrom: Temporal.Instant.from("2026-06-12T07:00:00Z"),
  reservedUntil: Temporal.Instant.from("2026-06-12T11:00:00Z"),
  seats: 1,
  ...overrides,
});

const labels = (reservation: ReservationEmailReservation) =>
  reservationEmailDetails(reservation, "en-US").map(({ label }) => label);

describe("reservation email details", () => {
  test("adds the setup start of a meeting room booked with early setup", () => {
    const setupLabel = m.reservationEmailSetupLabel({}, { locale: "en-US" });
    const earlySetup = makeReservation({
      reservationDetails: { kind: "meeting-room", earlySetup: true },
      setupFrom: Temporal.Instant.from("2026-06-12T06:45:00Z"),
    });

    expect(reservationEmailDetails(earlySetup, "en-US")).toContainEqual({
      label: setupLabel,
      value: "8:45 AM",
    });
    expect(
      labels(makeReservation({ reservationDetails: { kind: "meeting-room" } }))
    ).not.toContain(setupLabel);
  });

  test("lists an office booking's inclusive date range and seats", () => {
    const office = makeReservation({
      reservationDetails: { kind: "office" },
      reservedFrom: Temporal.Instant.from("2026-06-11T22:00:00Z"),
      reservedUntil: Temporal.Instant.from("2026-06-14T22:00:00Z"),
      seats: 3,
    });
    const rows = reservationEmailDetails(office, "en-US");

    expect(rows).toContainEqual({
      label: m.reservationEmailDateLabel({}, { locale: "en-US" }),
      value: "Friday, June 12 – Sunday, June 14, 2026",
    });
    expect(rows).toContainEqual({
      label: m.reservationEmailSeatsLabel({}, { locale: "en-US" }),
      value: "3",
    });
  });

  test("lists monitors only for desks booked with them", () => {
    const monitorsLabel = m.reservationEmailMonitorsLabel(
      {},
      { locale: "en-US" }
    );

    expect(
      labels(
        makeReservation({
          reservationDetails: {
            kind: "cowork",
            entryTier: "profi",
            coffee: true,
            monitorOption: "2x27-qhd",
          },
        })
      )
    ).toContain(monitorsLabel);
    expect(
      labels(
        makeReservation({
          reservationDetails: {
            kind: "cowork",
            entryTier: "reserved-desk",
            coffee: false,
          },
        })
      )
    ).not.toContain(monitorsLabel);
    expect(labels(makeReservation())).not.toContain(monitorsLabel);
  });

  test("ends with the Dotypos and order references", () => {
    const reservation = makeReservation();

    expect(reservationEmailDetails(reservation, "en-US").slice(-2)).toEqual([
      {
        label: m.checkoutEmailDotyposReservationIdLabel(
          {},
          { locale: "en-US" }
        ),
        value: reservation.dotyposReservationId,
      },
      {
        label: m.checkoutStatusOrderIdLabel({}, { locale: "en-US" }),
        value: reservation.id,
      },
    ]);
  });

  test("writes the rows in the requested locale", () => {
    const reservation = makeReservation();

    expect(reservationEmailDetails(reservation, "cs-CZ")).not.toEqual(
      reservationEmailDetails(reservation, "en-US")
    );
  });
});
