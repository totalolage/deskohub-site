import { describe, expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import type { Reservation } from "../generated/effect.gen";
import { DotyposCustomerIdSchema, DotyposReservationSchema } from "../types";
import { seededReservationReads } from "./service.mock";

const dotyposCustomerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema);

const reservation = (overrides: Partial<Reservation>) =>
  Schema.decodeUnknownSync(DotyposReservationSchema)({
    _branchId: "branch-id",
    _cloudId: "cloud-id",
    _customerId: "customer-id",
    endDate: "2026-06-20T12:00:00.000Z",
    seats: "1",
    status: "NEW",
    ...overrides,
  });

const startOfDay = (day: number) =>
  new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString();

describe("seededReservationReads", () => {
  const visits = Array.from({ length: 250 }, (_, day) =>
    reservation({ id: `visit-${day}`, startDate: startOfDay(day) })
  );
  const reads = seededReservationReads([
    reservation({ id: "early", startDate: startOfDay(-1) }),
    ...visits.toReversed(),
    reservation({
      id: "other-customer",
      _customerId: "other-customer-id",
      startDate: startOfDay(10),
    }),
  ]);
  const options = {
    customerId: dotyposCustomerId("customer-id"),
    startsAtOrAfter: startOfDay(0),
    order: "startDateAscending",
  } as const;

  test("pages the filtered reservations by 100 with the next page", async () => {
    const pages = await Effect.runPromise(
      Effect.all(
        [1, 2, 3].map((page) =>
          reads.listReservationsPage({ ...options, page })
        )
      )
    );

    expect(pages.map((page) => page.reservations.length)).toEqual([
      100, 100, 50,
    ]);
    expect(pages.map((page) => page.nextPage)).toEqual([
      Option.some(2),
      Option.some(3),
      Option.none(),
    ]);
    expect(pages.flatMap((page) => page.reservations)).toEqual(visits);
  });

  test("applies the same filters as the full listing", async () => {
    const bounded = {
      ...options,
      startsBefore: startOfDay(20),
      order: "startDateDescending",
    } as const;

    const [listing, page] = await Effect.runPromise(
      Effect.all([
        reads.listReservations(bounded),
        reads.listReservationsPage({ ...bounded, page: 1 }),
      ])
    );

    expect(listing).toEqual(visits.slice(0, 20).toReversed());
    expect(page).toEqual({ reservations: listing, nextPage: Option.none() });
  });
});
