import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { instantStringSchema } from "@/shared/utils/temporal";
import { normalizeReservationIntervalFields } from "./reservation-interval-normalization";

const timeZone = "Europe/Prague";
const instant = Schema.decodeUnknownSync(instantStringSchema);

describe("normalizeReservationIntervalFields", () => {
  test("accepts explicit ISO instants without a reservation date", async () => {
    const interval = await Effect.runPromise(
      normalizeReservationIntervalFields(
        {
          startsAt: instant("2026-07-01T10:00:00.000Z"),
          endsAt: instant("2026-07-01T11:00:00.000Z"),
        },
        timeZone
      )
    );

    expect(interval.startsAt).toBe("2026-07-01T10:00:00Z");
    expect(interval.endsAt).toBe("2026-07-01T11:00:00Z");
  });

  test("rejects an end time before or equal start", async () => {
    await expect(
      Effect.runPromise(
        normalizeReservationIntervalFields(
          {
            startsAt: instant("2026-07-01T10:00:00+02:00"),
            endsAt: instant("2026-07-01T09:00:00+02:00"),
          },
          timeZone
        )
      )
    ).rejects.toMatchObject({
      _tag: "ReservationIntervalValidationError",
      path: "endsAt",
      message: "Reservation end time must be after start time.",
    });
  });
});
