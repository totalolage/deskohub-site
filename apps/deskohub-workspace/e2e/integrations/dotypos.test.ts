import { expect, test } from "bun:test";
import type { DiscountGroup } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import {
  dotyposTimestampMatches,
  selectE2EDotyposDiscountGroup,
  waitForConfirmedDotyposReservation,
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

test("matches ISO Dotypos timestamps to the selected meeting-room instant", () => {
  expect(
    dotyposTimestampMatches(
      "2099-09-01T08:00:00.000Z",
      "2099-09-01T08:00:00Z"
    )
  ).toBe(true);
  expect(
    dotyposTimestampMatches(
      "2099-09-01T09:00:00.000Z",
      "2099-09-01T08:00:00Z"
    )
  ).toBe(false);
});

test("matches epoch-millisecond Dotypos timestamps", () => {
  const expected = "2099-09-01T08:00:00Z";

  expect(
    dotyposTimestampMatches(String(new Date(expected).getTime()), expected)
  ).toBe(true);
});
