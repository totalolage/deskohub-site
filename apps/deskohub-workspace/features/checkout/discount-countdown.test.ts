import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import type { Discount } from "@/features/discounts/contracts";
import { getDiscountCountdownState } from "./discount-countdown";

const timedDiscount: Pick<Discount, "countdownStartsAt" | "expiresAt"> = {
  countdownStartsAt: "2026-08-01T10:00:00.000Z",
  expiresAt: "2026-08-02T10:00:00.000Z",
};

describe("getDiscountCountdown", () => {
  test("omits discounts without a complete countdown window", () => {
    expect(
      getDiscountCountdownState(
        { expiresAt: timedDiscount.expiresAt },
        Temporal.Instant.from("2026-08-01T12:00:00.000Z")
      )
    ).toEqual({});
  });

  test("omits the countdown and schedules its declared start", () => {
    expect(
      getDiscountCountdownState(
        timedDiscount,
        Temporal.Instant.from("2026-08-01T09:59:59.999Z")
      )
    ).toEqual({ refreshAfterMilliseconds: 1 });
  });

  test("counts hours and schedules the next displayed value", () => {
    expect(
      getDiscountCountdownState(
        timedDiscount,
        Temporal.Instant.from("2026-08-01T10:00:00.000Z")
      )
    ).toEqual({
      countdown: { value: 24, unit: "hour" },
      refreshAfterMilliseconds: 3_600_000,
    });
    expect(
      getDiscountCountdownState(
        timedDiscount,
        Temporal.Instant.from("2026-08-01T12:30:00.000Z")
      )
    ).toEqual({
      countdown: { value: 22, unit: "hour" },
      refreshAfterMilliseconds: 1_800_000,
    });
  });

  test("counts seconds throughout the final hour", () => {
    expect(
      getDiscountCountdownState(
        timedDiscount,
        Temporal.Instant.from("2026-08-02T09:00:00.000Z")
      )
    ).toEqual({
      countdown: { value: 3600, unit: "second" },
      refreshAfterMilliseconds: 1000,
    });
    expect(
      getDiscountCountdownState(
        timedDiscount,
        Temporal.Instant.from("2026-08-02T09:00:00.001Z")
      )
    ).toEqual({
      countdown: { value: 3600, unit: "second" },
      refreshAfterMilliseconds: 999,
    });
    expect(
      getDiscountCountdownState(
        timedDiscount,
        Temporal.Instant.from("2026-08-02T09:50:00.000Z")
      )
    ).toEqual({
      countdown: { value: 600, unit: "second" },
      refreshAfterMilliseconds: 1000,
    });
  });

  test("omits the countdown once the discount expires", () => {
    expect(
      getDiscountCountdownState(
        timedDiscount,
        Temporal.Instant.from("2026-08-02T10:00:00.000Z")
      )
    ).toEqual({});
  });
});
