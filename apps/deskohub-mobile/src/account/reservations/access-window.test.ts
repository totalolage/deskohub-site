import { describe, expect, test } from "bun:test";
import { DateTime, Duration, Option } from "effect";
import {
  AccessWindowState,
  accessWindowOf,
  accessWindowState,
  Countdown,
  countdownOf,
} from "./access-window";

const start = DateTime.makeUnsafe("2026-11-08T09:00:00.000Z");
const end = DateTime.makeUnsafe("2026-11-08T17:00:00.000Z");
const at = (iso: string) => DateTime.makeUnsafe(iso);

describe("accessWindowState", () => {
  test("is upcoming before the start, with the time until it", () => {
    expect(
      accessWindowState(at("2026-11-08T08:59:59.000Z"), start, end)
    ).toEqual(AccessWindowState.Upcoming({ startsIn: Duration.seconds(1) }));
  });

  test("is open exactly at the start, with the whole window left", () => {
    expect(accessWindowState(start, start, end)).toEqual(
      AccessWindowState.Open({ remaining: Duration.hours(8) })
    );
  });

  test("is open inside the window, with the time left", () => {
    expect(
      accessWindowState(at("2026-11-08T16:59:59.500Z"), start, end)
    ).toEqual(AccessWindowState.Open({ remaining: Duration.millis(500) }));
  });

  test("has ended exactly at the end", () => {
    expect(accessWindowState(end, start, end)).toEqual(
      AccessWindowState.Ended()
    );
  });

  test("has ended after the end", () => {
    expect(
      accessWindowState(at("2026-11-09T09:00:00.000Z"), start, end)
    ).toEqual(AccessWindowState.Ended());
  });
});

describe("accessWindowOf", () => {
  test("reads both times of the answer", () => {
    expect(
      accessWindowOf({
        accessStartsAt: "2026-11-08T09:00:00.000Z",
        accessEndsAt: "2026-11-08T17:00:00.000Z",
      })
    ).toEqual(Option.some({ startsAt: start, endsAt: end }));
  });

  test("has no window when a time is unreadable", () => {
    expect(
      accessWindowOf({
        accessStartsAt: "2026-11-08T09:00:00.000Z",
        accessEndsAt: "soon",
      })
    ).toEqual(Option.none());
  });
});

describe("countdownOf", () => {
  test("shows days and hours from a day on", () => {
    expect(
      countdownOf(Duration.sum(Duration.days(2), Duration.hours(5)))
    ).toEqual(Countdown.Days({ days: 2, hours: 5 }));
  });

  test("shows hours and minutes under a day", () => {
    expect(countdownOf(Duration.minutes(23 * 60 + 59))).toEqual(
      Countdown.Hours({ hours: 23, minutes: 59 })
    );
  });

  test("shows minutes and seconds under an hour", () => {
    expect(countdownOf(Duration.seconds(45 * 60 + 12))).toEqual(
      Countdown.Minutes({ minutes: 45, seconds: 12 })
    );
  });

  test("rounds a part second up, so a running countdown never reads zero", () => {
    expect(countdownOf(Duration.millis(300))).toEqual(
      Countdown.Seconds({ seconds: 1 })
    );
    expect(countdownOf(Duration.millis(59_001))).toEqual(
      Countdown.Minutes({ minutes: 1, seconds: 0 })
    );
  });
});
