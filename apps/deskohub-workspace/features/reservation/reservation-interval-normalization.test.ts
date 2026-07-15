import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  instantStringEffectSchema,
  localDateTimeEffectSchema,
} from "@/shared/utils/temporal";
import {
  getDurationMinutes,
  normalizeReservationIntervalFields,
} from "./reservation-interval-normalization";

const timeZone = "Europe/Prague";
const date = "2026-07-01";
const localDateTime = Schema.decodeUnknownSync(localDateTimeEffectSchema);
const instant = Schema.decodeUnknownSync(instantStringEffectSchema);

const toInstant = (value: string) =>
  Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString();

describe("normalizeReservationIntervalFields", () => {
  test("normalizes local date-times", async () => {
    const interval = await Effect.runPromise(
      normalizeReservationIntervalFields(
        {
          startsAt: localDateTime(`${date}T12:00`),
          endsAt: localDateTime(`${date}T13:30`),
        },
        timeZone
      )
    );

    expect(interval.startsAt).toBe(toInstant(`${date}T12:00`));
    expect(interval.endsAt).toBe(toInstant(`${date}T13:30`));
  });

  test("normalizes an explicit overnight local interval", async () => {
    const interval = await Effect.runPromise(
      normalizeReservationIntervalFields(
        {
          startsAt: localDateTime(`${date}T22:00`),
          endsAt: localDateTime("2026-07-02T22:00"),
        },
        timeZone
      )
    );

    expect(interval.startsAt).toBe(toInstant(`${date}T22:00`));
    expect(interval.endsAt).toBe(toInstant("2026-07-02T22:00"));
    expect(getDurationMinutes(interval)).toBe(24 * 60);
  });

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

  test("derives duration from the interval boundaries", async () => {
    const interval = await Effect.runPromise(
      normalizeReservationIntervalFields(
        {
          startsAt: localDateTime(`${date}T10:00`),
          endsAt: localDateTime(`${date}T12:00`),
        },
        timeZone
      )
    );

    expect(getDurationMinutes(interval)).toBe(120);
  });
});
