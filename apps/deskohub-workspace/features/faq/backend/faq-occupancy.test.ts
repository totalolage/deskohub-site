import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type {
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import { getFaqOccupancyStats } from "./faq-occupancy";

const coworkTableId = "cowork-table";

const makeTable = (input: Partial<DotyposTable> = {}): DotyposTable => ({
  _cloudId: "synthetic-cloud",
  id: coworkTableId,
  name: input.id ?? "Synthetic cowork table",
  seats: "4",
  tags: ["cowork:basic"],
  ...input,
});

const makeReservation = (
  input: Partial<DotyposReservation> = {}
): DotyposReservation => {
  const startDate = input.startDate ?? "2025-05-01T00:00:00Z";
  const endDate =
    input.endDate ??
    Temporal.Instant.from(startDate).add({ hours: 1 }).toString();

  return {
    _branchId: "synthetic-branch",
    _cloudId: "synthetic-cloud",
    _tableId: coworkTableId,
    seats: "1",
    status: "CONFIRMED",
    ...input,
    startDate,
    endDate,
  };
};

const makeReservationsAt = (
  count: number,
  startDate: string,
  input: Partial<DotyposReservation> = {}
) =>
  Array.from({ length: count }, (_, index) =>
    makeReservation({
      id: `reservation-${index}`,
      startDate,
      ...input,
    })
  );

const calculateStats = (input: {
  readonly now: string;
  readonly reservations?: readonly DotyposReservation[];
  readonly tables?: readonly DotyposTable[];
}) =>
  Effect.runSync(
    getFaqOccupancyStats({
      now: Temporal.Instant.from(input.now),
      reservations: input.reservations ?? [],
      tables: input.tables ?? [makeTable()],
    })
  );

describe("getFaqOccupancyStats", () => {
  test("uses the previous Prague calendar month across a year rollover", () => {
    const stats = calculateStats({
      now: "2025-01-15T12:00:00Z",
      reservations: [
        ...makeReservationsAt(4, "2024-11-30T23:00:00Z"),
        makeReservation({
          id: "current-month",
          startDate: "2024-12-31T23:00:00Z",
        }),
      ],
    });

    expect(stats.averageReservationsPerDay).toBe(0.1);
    expect(Object.keys(stats).sort()).toEqual([
      "averageReservationsPerDay",
      "coworkSeatCapacity",
    ]);
  });

  test("uses Prague month bounds through the spring daylight-saving change", () => {
    const stats = calculateStats({
      now: "2026-04-15T12:00:00Z",
      reservations: [
        ...makeReservationsAt(7, "2026-02-28T23:00:00Z"),
        makeReservation({
          id: "spring-transition",
          startDate: "2026-03-29T01:00:00Z",
        }),
        makeReservation({
          id: "before-month",
          startDate: "2026-02-28T22:59:59Z",
        }),
        makeReservation({
          id: "next-month",
          startDate: "2026-03-31T22:00:00Z",
        }),
      ],
    });

    expect(stats.averageReservationsPerDay).toBe(0.3);
  });

  test("uses Prague month bounds through the autumn daylight-saving change", () => {
    const stats = calculateStats({
      now: "2026-11-15T12:00:00Z",
      reservations: [
        ...makeReservationsAt(7, "2026-09-30T22:00:00Z"),
        makeReservation({
          id: "autumn-transition",
          startDate: "2026-10-25T01:00:00Z",
        }),
        makeReservation({
          id: "before-month",
          startDate: "2026-09-30T21:59:59Z",
        }),
        makeReservation({
          id: "next-month",
          startDate: "2026-10-31T23:00:00Z",
        }),
      ],
    });

    expect(stats.averageReservationsPerDay).toBe(0.3);
  });

  test("divides by all calendar days in 28, 29, 30, and 31-day months", () => {
    const cases = [
      {
        now: "2025-03-15T12:00:00Z",
        startsAt: "2025-02-01T00:00:00Z",
        count: 7,
        average: 0.3,
      },
      {
        now: "2024-03-15T12:00:00Z",
        startsAt: "2024-02-01T00:00:00Z",
        count: 16,
        average: 0.6,
      },
      {
        now: "2025-05-15T12:00:00Z",
        startsAt: "2025-04-01T00:00:00Z",
        count: 16,
        average: 0.5,
      },
      {
        now: "2025-02-15T12:00:00Z",
        startsAt: "2025-01-01T00:00:00Z",
        count: 17,
        average: 0.5,
      },
    ];

    for (const { now, startsAt, count, average } of cases) {
      const stats = calculateStats({
        now,
        reservations: makeReservationsAt(count, startsAt),
      });

      expect(stats.averageReservationsPerDay).toBe(average);
    }
  });

  test("includes the exact month start and excludes the exact next-month start", () => {
    const stats = calculateStats({
      now: "2025-06-15T12:00:00Z",
      reservations: [
        ...makeReservationsAt(5, "2025-04-30T22:00:00Z"),
        ...makeReservationsAt(5, "2025-04-30T21:59:59Z", {
          id: "before-start",
        }),
        ...makeReservationsAt(5, "2025-05-31T22:00:00Z", {
          id: "at-end",
        }),
      ],
    });

    expect(stats.averageReservationsPerDay).toBe(0.2);
  });

  test("counts unique confirmed cowork reservation IDs and excludes other statuses and dates", () => {
    const duplicate = makeReservation({ id: "duplicate" });
    const otherStatus = {
      ...makeReservation({ id: "other-status" }),
      status: "PENDING",
    } as DotyposReservation;

    const stats = calculateStats({
      now: "2025-06-15T12:00:00Z",
      reservations: [
        makeReservation({ id: "confirmed" }),
        duplicate,
        { ...duplicate },
        makeReservation({ id: "new", status: "NEW" }),
        makeReservation({ id: "cancelled", status: "CANCELLED" }),
        otherStatus,
        makeReservation({ id: "before", startDate: "2025-04-30T21:59:59Z" }),
        makeReservation({ id: "after", startDate: "2025-05-31T22:00:00Z" }),
      ],
    });

    expect(stats.averageReservationsPerDay).toBe(0.1);
  });

  test("uses literal cowork table tags across rooms without display or enabled filters", () => {
    const stats = calculateStats({
      now: "2025-06-15T12:00:00Z",
      reservations: [
        makeReservation({ id: "first-room", _tableId: "cowork-one" }),
        makeReservation({ id: "second-room", _tableId: "cowork-two" }),
        makeReservation({ id: "tier-only", _tableId: "tier-only" }),
      ],
      tables: [
        makeTable({
          id: "cowork-one",
          seats: "4",
          locationName: "Room A",
          enabled: false,
          display: false,
        }),
        makeTable({
          id: "cowork-two",
          seats: "3",
          locationName: "Room B",
          tags: ["other", "cowork:meeting-room"],
        }),
        makeTable({
          id: "tier-only",
          seats: "20",
          tags: ["tier:basic"],
        }),
        makeTable({ id: "no-tag", seats: "30", tags: undefined }),
        makeTable({ id: "not-prefix", seats: "40", tags: ["coworking:basic"] }),
      ],
    });

    expect(stats.coworkSeatCapacity).toBe(7);
    expect(stats.averageReservationsPerDay).toBe(0.1);
  });

  test("deduplicates identified cowork tables and returns zero for no matching tables", () => {
    const stats = calculateStats({
      now: "2025-06-15T12:00:00Z",
      tables: [
        makeTable({ id: "same-table", seats: "4" }),
        makeTable({ id: "same-table", seats: "4", locationName: "Other" }),
        makeTable({ id: "tier-only", tags: ["tier:basic"] }),
      ],
    });
    const emptyStats = calculateStats({
      now: "2025-06-15T12:00:00Z",
      reservations: [makeReservation()],
      tables: [makeTable({ id: "tier-only", tags: ["tier:basic"] })],
    });

    expect(stats.coworkSeatCapacity).toBe(4);
    expect(emptyStats).toEqual({
      averageReservationsPerDay: 0,
      coworkSeatCapacity: 0,
    });
  });

  test("rejects relevant malformed table IDs and seat capacities", () => {
    for (const id of [undefined, "   "]) {
      expect(() =>
        calculateStats({
          now: "2025-06-15T12:00:00Z",
          tables: [makeTable({ id })],
        })
      ).toThrow("Cowork-tagged Dotypos table has an invalid ID");
    }

    for (const seats of [undefined, "invalid", "2.5", "0", "-1"]) {
      expect(() =>
        calculateStats({
          now: "2025-06-15T12:00:00Z",
          tables: [makeTable({ id: "invalid-seats", seats })],
        })
      ).toThrow("Cowork-tagged Dotypos table has an invalid seat capacity");
    }
  });

  test("rejects relevant malformed reservation IDs and intervals", () => {
    expect(() =>
      calculateStats({
        now: "2025-06-15T12:00:00Z",
        reservations: [makeReservation({ id: "   " })],
      })
    ).toThrow("Confirmed cowork Dotypos reservation has an invalid ID");

    expect(() =>
      calculateStats({
        now: "2025-06-15T12:00:00Z",
        reservations: [
          makeReservation({
            id: "invalid-interval",
            startDate: "not-a-date",
            endDate: "2025-05-01T01:00:00Z",
          }),
        ],
      })
    ).toThrow("Confirmed cowork Dotypos reservation has an invalid interval");
  });

  test("rounds the average to one decimal and preserves a zero average", () => {
    const roundedStats = calculateStats({
      now: "2024-03-15T12:00:00Z",
      reservations: makeReservationsAt(16, "2024-02-01T00:00:00Z"),
    });
    const zeroStats = calculateStats({ now: "2024-03-15T12:00:00Z" });

    expect(roundedStats.averageReservationsPerDay).toBe(0.6);
    expect(zeroStats.averageReservationsPerDay).toBe(0);
  });
});
