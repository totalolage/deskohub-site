import { describe, expect, test } from "bun:test";
import { DateTime, Option } from "effect";
import { m } from "../../i18n/messages";
import {
  type ReservationListRow,
  reservationGroups,
  reservationRowText,
  reservationStatusTarget,
} from "./reservation-list-model";

const now = DateTime.makeUnsafe("2026-11-08T12:00:00Z");
const row = (
  id: string,
  change: Partial<ReservationListRow> = {}
): ReservationListRow => ({
  id,
  product: { kind: "meeting-room" },
  startsAt: "2026-11-08T09:00:00Z",
  endsAt: "2026-11-08T17:00:00Z",
  seats: 2,
  status: "confirmed",
  ...change,
});
const ids = (rows: ReadonlyArray<ReservationListRow>) => rows.map((r) => r.id);

describe("reservationGroups", () => {
  test("features the first current reservation and lists the others", () => {
    const groups = reservationGroups(
      {
        current: [row("a"), row("b"), row("c")],
        past: [row("p", { endsAt: "2026-11-01T10:00:00Z" })],
        unavailable: [row("u", { startsAt: null, endsAt: null })],
      },
      now
    );

    expect(Option.map(groups.featured, (r) => r.id)).toEqual(Option.some("a"));
    expect(ids(groups.moreCurrent)).toEqual(["b", "c"]);
    expect(ids(groups.past)).toEqual(["p"]);
    expect(ids(groups.undated)).toEqual(["u"]);
    expect(groups.empty).toBe(false);
  });

  test("moves a current reservation that has ended to the top of past", () => {
    const groups = reservationGroups(
      {
        current: [
          row("ended", { endsAt: "2026-11-08T11:00:00Z" }),
          row("ends-now", { endsAt: "2026-11-08T12:00:00Z" }),
          row("running"),
        ],
        past: [row("older", { endsAt: "2026-11-01T10:00:00Z" })],
        unavailable: [],
      },
      now
    );

    expect(Option.map(groups.featured, (r) => r.id)).toEqual(
      Option.some("running")
    );
    expect(groups.moreCurrent).toEqual([]);
    expect(ids(groups.past)).toEqual(["ended", "ends-now", "older"]);
  });

  test("is empty only without any reservation", () => {
    expect(
      reservationGroups({ current: [], past: [], unavailable: [] }, now).empty
    ).toBe(true);
    expect(
      reservationGroups({ current: [], past: [], unavailable: [row("u")] }, now)
        .empty
    ).toBe(false);
  });
});

describe("reservationRowText", () => {
  test("shows a missing time and seat count as unavailable, never blank", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const text = reservationRowText(
        row("x", {
          startsAt: null,
          endsAt: "2026-11-08T17:00:00Z",
          seats: null,
        }),
        locale
      );
      expect(text.period).toBe(
        m.reservations_value_unavailable({}, { locale })
      );
      expect(text.seats).toBe(m.reservations_seats_unavailable({}, { locale }));
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.status.length).toBeGreaterThan(0);
    }
  });

  test("shows an unreadable time as unavailable", () => {
    const text = reservationRowText(row("x", { endsAt: "soon" }), "en-US");
    expect(text.period).toBe(
      m.reservations_value_unavailable({}, { locale: "en-US" })
    );
  });

  test("shows an office booking's days without times", () => {
    const office = reservationRowText(
      row("o", {
        product: { kind: "office" },
        startsAt: "2026-11-29T23:00:00Z",
        endsAt: "2026-11-30T23:00:00Z",
      }),
      "en-US"
    );
    expect(office.period).toBe("Monday, November 30, 2026");
  });

  test("shows the period, and the setup start only when booked with setup", () => {
    const plain = reservationRowText(row("x"), "en-US");
    expect(plain.period).not.toBe(
      m.reservations_value_unavailable({}, { locale: "en-US" })
    );
    expect(Option.isNone(plain.setup)).toBe(true);

    const withSetup = reservationRowText(
      row("y", { setupStartsAt: "2026-11-08T08:30:00Z" }),
      "en-US"
    );
    expect(Option.isSome(withSetup.setup)).toBe(true);
  });
});

describe("reservationStatusTarget", () => {
  test("opens the status of a row with an order, and none without", () => {
    const orderId = "order-1" as ReservationListRow["orderId"];
    expect(reservationStatusTarget(row("x", { orderId }))).toEqual(
      Option.fromNullishOr(orderId)
    );
    expect(Option.isNone(reservationStatusTarget(row("y")))).toBe(true);
  });
});
