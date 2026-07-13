import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { defaultReservationInterval } from "./reservation-interval-domain";
import {
  getDurationMinutes,
  normalizeReservationIntervalFields,
} from "./reservation-interval-normalization";

const timeZone = "Europe/Prague";
const date = "2026-07-01";

const toInstant = (value: string) =>
  Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString();

describe("normalizeReservationIntervalFields", () => {
  test("normalizes local times against provided reservation date", async () => {
    const interval = await Effect.runPromise(
      normalizeReservationIntervalFields(
        { date, startsAt: "12:00", endsAt: "13:30" },
        timeZone
      )
    );

    expect(interval.startsAt).toBe(toInstant(`${date}T12:00`));
    expect(interval.endsAt).toBe(toInstant(`${date}T13:30`));
  });

  test("wraps local end time to the next day when it is before or equal start", async () => {
    const interval = await Effect.runPromise(
      normalizeReservationIntervalFields(
        { date, startsAt: "22:00", endsAt: "22:00" },
        timeZone
      )
    );

    expect(interval.startsAt).toBe(toInstant(`${date}T22:00`));
    expect(interval.endsAt).toBe(toInstant("2026-07-02T22:00"));
    expect(getDurationMinutes(interval)).toBe(24 * 60);
  });

  test("normalizes optional defaults to a full-day interval when only date is supplied", async () => {
    const interval = await Effect.runPromise(
      normalizeReservationIntervalFields({ date }, timeZone)
    );

    expect(interval.startsAt).toBe(toInstant(`${date}T00:00`));
    expect(interval.endsAt).toBe(toInstant("2026-07-02T00:00"));
    expect(getDurationMinutes(interval)).toBe(24 * 60);
  });

  test("accepts explicit ISO instants without a reservation date", async () => {
    const interval = await Effect.runPromise(
      normalizeReservationIntervalFields(
        {
          startsAt: "2026-07-01T10:00:00.000Z",
          endsAt: "2026-07-01T11:00:00.000Z",
        },
        timeZone
      )
    );

    expect(interval.startsAt).toBe("2026-07-01T10:00:00Z");
    expect(interval.endsAt).toBe("2026-07-01T11:00:00Z");
  });

  test("rejects start times that do not match the provided reservation date", async () => {
    await expect(
      Effect.runPromise(
        normalizeReservationIntervalFields(
          {
            date,
            startsAt: "2026-07-02T10:00:00+02:00",
            endsAt: "2026-07-02T11:00:00+02:00",
          },
          timeZone
        )
      )
    ).rejects.toMatchObject({
      _tag: "ReservationIntervalValidationError",
      path: "startsAt",
      message: "Reservation start time must match reservation date.",
    });
  });

  test("rejects an end time before or equal start", async () => {
    await expect(
      Effect.runPromise(
        normalizeReservationIntervalFields(
          {
            date,
            startsAt: "2026-07-01T10:00:00+02:00",
            endsAt: "2026-07-01T09:00:00+02:00",
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

  test("rejects a duration mismatch when provided", async () => {
    await expect(
      Effect.runPromise(
        normalizeReservationIntervalFields(
          {
            date,
            startsAt: `${date}T10:00`,
            endsAt: `${date}T12:00`,
            durationMinutes: 90,
          },
          timeZone
        )
      )
    ).rejects.toMatchObject({
      _tag: "ReservationIntervalValidationError",
      path: "endsAt",
      message: "Reservation duration must match start and end time.",
    });
  });
});

describe("Reservation interval defaults", () => {
  test("default interval values are explicit default startsAt/endsAt", () => {
    expect(defaultReservationInterval).toEqual({
      startsAt: "00:00",
      endsAt: "24:00",
    });
  });
});
