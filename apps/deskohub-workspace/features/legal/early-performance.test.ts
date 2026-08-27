import "@/shared/polyfills/temporal";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { Schema } from "effect";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import {
  getConsumerWithdrawalPeriodCutoff,
  getEarlyPerformanceRequestRequiredAt,
  isEarlyPerformanceRequestRequired,
} from "./early-performance";

const contractAt = Temporal.Instant.from("2026-08-12T12:00:00Z");

beforeEach(() => setSystemTime(new Date("2026-08-12T12:00:00Z")));
afterEach(() => setSystemTime());

const coworkReservation = (date: string) =>
  Schema.decodeUnknownSync(reservationOrderSchema)({
    kind: "cowork",
    entryTier: "basic",
    date,
    coffee: false,
    name: "Synthetic Customer",
    email: "customer@example.com",
    phone: "+420 700 000 000",
  });

describe("early-performance request", () => {
  test("uses the end of the fourteenth following Workspace calendar day", () => {
    expect(getConsumerWithdrawalPeriodCutoff(contractAt).toString()).toBe(
      "2026-08-26T22:00:00Z"
    );
    expect(
      isEarlyPerformanceRequestRequired({
        contractAt,
        reservation: coworkReservation("2026-08-26"),
      })
    ).toBe(true);
    expect(
      isEarlyPerformanceRequestRequired({
        contractAt,
        reservation: coworkReservation("2026-08-27"),
      })
    ).toBe(false);
  });

  test("identifies the exact instant when the request becomes applicable", () => {
    expect(
      getEarlyPerformanceRequestRequiredAt(
        coworkReservation("2026-08-27")
      ).toString()
    ).toBe("2026-08-12T22:00:00Z");
  });

  test("keeps the cutoff on the Workspace calendar across daylight saving", () => {
    expect(
      getConsumerWithdrawalPeriodCutoff(
        Temporal.Instant.from("2026-10-20T10:00:00Z")
      ).toString()
    ).toBe("2026-11-03T23:00:00Z");
  });
});
