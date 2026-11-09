import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer, Result } from "effect";
import { ReadLimitExceededError } from "@/shared/backend/read-limit";
import { CustomerBookedReservations } from "./customer-booked-reservations";
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

const listForCustomer = (
  reservations: readonly DotyposReservation[],
  limit: number
) => {
  const dotypos = countedDotyposReservationReads(reservations);
  const read = Effect.flatMap(CustomerBookedReservations, (bookings) =>
    bookings.listForCustomer({ customerId: customer, limit })
  ).pipe(
    Effect.provide(
      CustomerBookedReservations.Provider.pipe(Layer.provide(dotypos.layer))
    ),
    Effect.result
  );
  return Effect.runPromise(read).then((result) => ({
    result,
    requests: dotypos.requests(),
  }));
};

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
          startsAt: firstStart.add({ hours: 1 }),
          endsAt: firstStart.add({ hours: 1, minutes: 30 }),
          seats: 2,
        },
        {
          dotyposReservationId: DotyposReservationIdSchema.make(
            `${customer}-0`
          ),
          status: "CONFIRMED",
          startsAt: firstStart,
          endsAt: firstStart.add({ minutes: 30 }),
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
});
