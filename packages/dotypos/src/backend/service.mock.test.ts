import { describe, expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import type { Reservation } from "../generated/effect.gen";
import {
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  DotyposReservationSchema,
} from "../types";
import { seededCustomerReads, seededReservationReads } from "./service.mock";

const dotyposCustomerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema);

const customer = (id: string) =>
  Schema.decodeSync(DotyposCustomerSchema)({
    _cloudId: "cloud-id",
    id,
    firstName: "Ada",
    points: null,
    flags: "0",
    display: true,
    deleted: false,
  });

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

describe("seededCustomerReads", () => {
  test("selects customers by ID and preserves the seeded order", async () => {
    const seeded = [customer("customer-1"), customer("customer-2")];
    const reads = seededCustomerReads(seeded);

    const selected = await Effect.runPromise(
      reads.getCustomersByIds([
        dotyposCustomerId("customer-2"),
        dotyposCustomerId("missing"),
      ])
    );

    expect([...selected.values()]).toEqual([customer("customer-2")]);
  });
});

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

describe("seededReservationReads active reservations", () => {
  const at = (hour: number) =>
    new Date(Date.UTC(2026, 0, 1, hour)).toISOString();
  const interval = {
    startDate: new Date(at(10)),
    endDate: new Date(at(12)),
  };

  test("pages the NEW and CONFIRMED reservations overlapping the interval", async () => {
    const overlapping = Array.from({ length: 150 }, (_, index) =>
      reservation({
        id: `overlapping-${index}`,
        status: index % 2 === 0 ? "NEW" : "CONFIRMED",
        startDate: at(9),
        endDate: at(11),
      })
    );
    const reads = seededReservationReads([
      ...overlapping,
      reservation({
        id: "cancelled",
        status: "CANCELLED",
        startDate: at(10),
        endDate: at(11),
      }),
      reservation({ id: "ends-at-start", startDate: at(8), endDate: at(10) }),
      reservation({ id: "starts-at-end", startDate: at(12), endDate: at(13) }),
    ]);

    const pages = await Effect.runPromise(
      Effect.all(
        [1, 2].map((page) => reads.listActiveReservationsPage(interval, page))
      )
    );

    expect(pages.map((page) => page.nextPage)).toEqual([
      Option.some(2),
      Option.none(),
    ]);
    expect(pages.flatMap((page) => page.reservations)).toEqual(overlapping);
  });
});
