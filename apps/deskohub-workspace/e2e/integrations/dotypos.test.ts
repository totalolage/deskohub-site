import { expect, test } from "bun:test";
import {
  DotyposDiscountGroupIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import type { DiscountGroup } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import {
  dotyposTimestampMatches,
  selectE2EDotyposDiscountGroup,
  waitForConfirmedDotyposReservation,
  waitForDotyposCancellationConvergence,
  waitForDotyposCustomerDiscountGroup,
} from "./dotypos";

test("selects an active partial Dotypos discount deterministically", () => {
  const selected = selectE2EDotyposDiscountGroup([
    { id: "deleted", deleted: true, discountPercent: "5" },
    { id: "full", discountPercent: "100" },
    { id: "malformed", discountPercent: "10.005" },
    { id: "later", discountPercent: "12.5" },
    { id: "second", discountPercent: "7.5" },
    { id: "first", discountPercent: "7.5" },
    { id: "fractional", discountPercent: "0.07" },
  ] satisfies readonly DiscountGroup[]);

  expect(selected).toEqual({ basisPoints: 7, id: "fractional" });
});

test("requires a usable Dotypos customer-discount group", () => {
  expect(() =>
    selectE2EDotyposDiscountGroup([
      { id: "deleted", deleted: true, discountPercent: "10" },
      { id: "full", discountPercent: "100" },
    ])
  ).toThrow(
    "the E2E Dotypos cloud must contain an active percentage discount group from 0.01% through 90%"
  );
});

test("rejects a near-total group that leaves too little for stacked discounts", () => {
  expect(() =>
    selectE2EDotyposDiscountGroup([
      { id: "near-total", discountPercent: "99.99" },
    ])
  ).toThrow(
    "the E2E Dotypos cloud must contain an active percentage discount group from 0.01% through 90%"
  );
});

test("waits for Dotypos to expose the confirmed reservation state", async () => {
  let reads = 0;
  const result = await Effect.runPromise(
    waitForConfirmedDotyposReservation(
      Effect.sync(() => {
        reads += 1;
        return {
          reservation: {
            status: reads < 3 ? "NEW" : "CONFIRMED",
          },
        };
      }),
      { intervalMs: 1, timeoutMs: 100 }
    )
  );

  expect(result.reservation.status).toBe("CONFIRMED");
  expect(reads).toBe(3);
});

test("waits for cancelled reservations to leave active inventory", async () => {
  let reads = 0;
  const reservationId = DotyposReservationIdSchema.make("target-reservation");
  await Effect.runPromise(
    waitForDotyposCancellationConvergence(
      Effect.sync(() => {
        reads += 1;
        return [
          ...(reads < 3
            ? [{ id: reservationId, status: "CONFIRMED" as const }]
            : []),
        ];
      }),
      [reservationId],
      { intervalMs: 1, timeoutMs: 100 }
    )
  );

  expect(reads).toBe(3);
});

test("uses the active-overlap read model for cleanup convergence", async () => {
  const source = await Bun.file(
    new URL("./dotypos.ts", import.meta.url)
  ).text();

  expect(
    source.match(/dotypos\.listActiveReservationsOverlapping\(interval\)/g)
  ).toHaveLength(3);
  expect(source).not.toContain("dotypos.listReservations(),");
});

test("waits for a customer discount-group change to become readable", async () => {
  let reads = 0;
  const discountGroupId = DotyposDiscountGroupIdSchema.make("group-id");
  const customer = await Effect.runPromise(
    waitForDotyposCustomerDiscountGroup(
      Effect.sync(() => {
        reads += 1;
        return {
          _discountGroupId: reads < 3 ? null : discountGroupId,
        };
      }),
      discountGroupId,
      { intervalMs: 1, timeoutMs: 100 }
    )
  );

  expect(customer._discountGroupId).toBe("group-id");
  expect(reads).toBe(3);
});

test("waits for a removed customer discount group to become readable", async () => {
  let reads = 0;
  const discountGroupId = DotyposDiscountGroupIdSchema.make("group-id");
  const customer = await Effect.runPromise(
    waitForDotyposCustomerDiscountGroup(
      Effect.sync(() => {
        reads += 1;
        return {
          _discountGroupId: reads < 2 ? discountGroupId : null,
        };
      }),
      null,
      { intervalMs: 1, timeoutMs: 100 }
    )
  );

  expect(customer._discountGroupId).toBeNull();
  expect(reads).toBe(2);
});

test("matches ISO Dotypos timestamps to the selected meeting-room instant", () => {
  expect(
    dotyposTimestampMatches("2099-09-01T08:00:00.000Z", "2099-09-01T08:00:00Z")
  ).toBe(true);
  expect(
    dotyposTimestampMatches("2099-09-01T09:00:00.000Z", "2099-09-01T08:00:00Z")
  ).toBe(false);
});

test("matches epoch-millisecond Dotypos timestamps", () => {
  const expected = "2099-09-01T08:00:00Z";

  expect(
    dotyposTimestampMatches(String(new Date(expected).getTime()), expected)
  ).toBe(true);
});
