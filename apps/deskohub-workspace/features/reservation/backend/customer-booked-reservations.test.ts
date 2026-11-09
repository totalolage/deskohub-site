import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
  type DotyposService,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer, Option, Result } from "effect";
import { ReadLimitExceededError } from "@/shared/backend/read-limit";
import {
  CustomerBookedReservations,
  CustomerBookedReservationsUnreadableError,
} from "./customer-booked-reservations";
import { countedDotyposReservationReads } from "./reservation-visits.test-utils";

const customer = DotyposCustomerIdSchema.make("booked-customer");
const otherCustomer = DotyposCustomerIdSchema.make("booked-other-customer");
const firstStart = Temporal.Instant.from("2027-03-01T08:00:00Z");

const reservationsOf = (
  customerId: DotyposCustomerId,
  count: number
): DotyposReservation[] =>
  Array.from({ length: count }, (_, index) => {
    const startsAt = firstStart.add({ hours: index });
    return {
      id: DotyposReservationIdSchema.make(`${customerId}-${index}`),
      _branchId: "branch",
      _cloudId: "cloud",
      _customerId: customerId,
      _tableId: "table",
      startDate: startsAt.toString(),
      endDate: startsAt.add({ minutes: 30 }).toString(),
      seats: "2",
      status: "CONFIRMED",
      note: "synthetic note",
    };
  });

const readWith = (dotypos: Layer.Layer<DotyposService>, limit: number) =>
  Effect.runPromise(
    Effect.flatMap(CustomerBookedReservations, (bookings) =>
      bookings.listForCustomer({ customerId: customer, limit })
    ).pipe(
      Effect.provide(
        CustomerBookedReservations.Provider.pipe(Layer.provide(dotypos))
      ),
      Effect.result
    )
  );

const listForCustomer = async (
  reservations: readonly DotyposReservation[],
  limit: number
) => {
  const dotypos = countedDotyposReservationReads(reservations);
  const result = await readWith(dotypos.layer, limit);
  return { result, requests: dotypos.requests() };
};

/** Dotypos answering each page number with the given page. */
const pagedDotypos = (
  pages: ReadonlyArray<{
    readonly reservations: readonly DotyposReservation[];
    readonly nextPage?: number;
  }>
) =>
  DotyposServiceMock({
    listReservationsPage: ({ page }) => {
      const answer = pages[page - 1];
      return Effect.succeed({
        reservations: answer?.reservations ?? [],
        nextPage: Option.fromUndefinedOr(answer?.nextPage),
      });
    },
  });

describe("CustomerBookedReservations.listForCustomer", () => {
  test("reads only the customer's reservations, newest start first, without table, note, or customer link", async () => {
    const { result } = await listForCustomer(
      [...reservationsOf(otherCustomer, 3), ...reservationsOf(customer, 2)],
      5
    );

    expect(result).toEqual(
      Result.succeed([
        {
          dotyposReservationId: DotyposReservationIdSchema.make(
            `${customer}-1`
          ),
          status: "CONFIRMED",
          heldFrom: firstStart.add({ hours: 1 }),
          heldUntil: firstStart.add({ hours: 1, minutes: 30 }),
          seats: 2,
        },
        {
          dotyposReservationId: DotyposReservationIdSchema.make(
            `${customer}-0`
          ),
          status: "CONFIRMED",
          heldFrom: firstStart,
          heldUntil: firstStart.add({ minutes: 30 }),
          seats: 2,
        },
      ])
    );
  });

  test("returns exactly `limit` reservations spread over several pages", async () => {
    const { result, requests } = await listForCustomer(
      reservationsOf(customer, 150),
      150
    );

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") expect(result.success).toHaveLength(150);
    expect(requests).toBe(2);
  });

  test("fails on one reservation past `limit` and stops paging once it is seen", async () => {
    const justOver = await listForCustomer(reservationsOf(customer, 151), 150);
    expect(justOver.result).toEqual(
      Result.fail(new ReadLimitExceededError({ limit: 150 }))
    );

    const farOver = await listForCustomer(reservationsOf(customer, 450), 150);
    expect(farOver.result._tag).toBe("Failure");
    expect(farOver.requests).toBe(2);
  });

  test("fails on a reservation whose held span or seats can't be read", async () => {
    const [readable, unreadable] = reservationsOf(customer, 2);
    for (const malformed of [
      { seats: "many" },
      { endDate: unreadable!.startDate },
      { endDate: firstStart.toString() },
    ]) {
      const { result } = await listForCustomer(
        [readable!, { ...unreadable!, ...malformed }],
        5
      );

      expect(result).toEqual(
        Result.fail(
          new CustomerBookedReservationsUnreadableError({
            reason: "malformed-reservation",
            dotyposReservationId: unreadable!.id,
          })
        )
      );
    }
  });

  test("fails on pages that contradict each other", async () => {
    const [first, second] = reservationsOf(customer, 2);
    const inconsistent = Result.fail(
      new CustomerBookedReservationsUnreadableError({
        reason: "inconsistent-pages",
      })
    );

    expect(
      await readWith(
        pagedDotypos([
          { reservations: [first!], nextPage: 2 },
          { reservations: [], nextPage: 3 },
          { reservations: [second!] },
        ]),
        5
      )
    ).toEqual(inconsistent);
    expect(
      await readWith(
        pagedDotypos([
          { reservations: [first!, second!], nextPage: 2 },
          { reservations: [second!] },
        ]),
        5
      )
    ).toEqual(inconsistent);
  });
});
