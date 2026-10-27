import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  getIgloohomeAccessWindow,
  isSameIgloohomeAccessWindow,
} from "./igloohome-access-window";

const at = (value: string) => Temporal.Instant.from(value);

describe("getIgloohomeAccessWindow", () => {
  test("opens from the hour that contains an early-setup start", () => {
    expect(
      Option.getOrNull(
        getIgloohomeAccessWindow({
          startsAt: at("2026-07-01T07:45:00Z"),
          endsAt: at("2026-07-01T09:00:00Z"),
          now: at("2026-06-30T10:00:00Z"),
        })
      )
    ).toEqual({
      startsAt: "2026-07-01T09:00:00+02:00",
      endsAt: "2026-07-01T11:00:00+02:00",
    });
  });

  test("rounds a span outward to whole Prague hours", () => {
    expect(
      Option.getOrNull(
        getIgloohomeAccessWindow({
          startsAt: at("2026-07-01T08:30:00Z"),
          endsAt: at("2026-07-01T10:15:00Z"),
          now: at("2026-07-01T07:00:00Z"),
        })
      )
    ).toEqual({
      startsAt: "2026-07-01T10:00:00+02:00",
      endsAt: "2026-07-01T13:00:00+02:00",
    });
  });

  test("opens from the current Prague hour once the span has started", () => {
    expect(
      Option.getOrNull(
        getIgloohomeAccessWindow({
          startsAt: at("2026-07-01T07:45:00Z"),
          endsAt: at("2026-07-01T09:00:00Z"),
          now: at("2026-07-01T08:20:00Z"),
        })
      )
    ).toEqual({
      startsAt: "2026-07-01T10:00:00+02:00",
      endsAt: "2026-07-01T11:00:00+02:00",
    });
  });

  test("keeps Prague offsets across a DST change", () => {
    expect(
      Option.getOrNull(
        getIgloohomeAccessWindow({
          startsAt: at("2026-10-23T21:45:00Z"),
          endsAt: at("2026-10-25T23:00:00Z"),
          now: at("2026-10-01T10:12:00Z"),
        })
      )
    ).toEqual({
      startsAt: "2026-10-23T23:00:00+02:00",
      endsAt: "2026-10-26T00:00:00+01:00",
    });
  });

  test("accepts 672 hours and rejects 673 hours after rounding", () => {
    const startsAt = at("2026-01-01T00:00:00Z");
    const now = startsAt.subtract({ hours: 1 });

    expect(
      Option.isSome(
        getIgloohomeAccessWindow({
          startsAt,
          endsAt: startsAt.add({ hours: 672 }),
          now,
        })
      )
    ).toBe(true);
    expect(
      Option.isNone(
        getIgloohomeAccessWindow({
          startsAt: startsAt.add({ minutes: 30 }),
          endsAt: startsAt.add({ hours: 672, minutes: 30 }),
          now,
        })
      )
    ).toBe(true);
  });
});

describe("isSameIgloohomeAccessWindow", () => {
  test("matches spans that program the same hours", () => {
    expect(
      isSameIgloohomeAccessWindow(
        {
          startsAt: at("2026-07-01T07:00:00Z"),
          endsAt: at("2026-07-01T09:00:00Z"),
        },
        {
          startsAt: at("2026-07-01T07:45:00Z"),
          endsAt: at("2026-07-01T09:00:00Z"),
        }
      )
    ).toBe(true);
  });

  test("tells apart spans that program different hours", () => {
    expect(
      isSameIgloohomeAccessWindow(
        {
          startsAt: at("2026-07-01T07:00:00Z"),
          endsAt: at("2026-07-01T09:00:00Z"),
        },
        {
          startsAt: at("2026-07-01T08:45:00Z"),
          endsAt: at("2026-07-01T10:00:00Z"),
        }
      )
    ).toBe(false);
  });
});
