import { describe, expect, it } from "bun:test";
import { Option } from "effect";
import {
  chainedReservationActivityWindow,
  dueReservationActivityWindow,
} from "./reservation-activity-sweep-window";

const instant = (value: string) => Temporal.Instant.from(value);

const windowStrings = (
  window: Option.Option<{
    readonly startsAt: Temporal.Instant;
    readonly endsAt: Temporal.Instant;
  }>
) =>
  Option.getOrNull(
    Option.map(window, ({ startsAt, endsAt }) => [
      startsAt.toString(),
      endsAt.toString(),
    ])
  );

describe("dueReservationActivityWindow", () => {
  it("re-sweeps two minutes before swept time up to now", () => {
    expect(
      windowStrings(
        dueReservationActivityWindow(
          "reservation-activity",
          instant("2026-10-19T10:00:00Z"),
          instant("2026-10-19T10:01:00Z")
        )
      )
    ).toEqual(["2026-10-19T09:58:00Z", "2026-10-19T10:01:00Z"]);
  });

  it("caps a catch-up window at six hours", () => {
    expect(
      windowStrings(
        dueReservationActivityWindow(
          "reservation-activity",
          instant("2026-10-19T00:00:00Z"),
          instant("2026-10-19T09:00:00Z")
        )
      )
    ).toEqual(["2026-10-18T23:58:00Z", "2026-10-19T06:00:00Z"]);
  });

  it("opens nothing once swept up to now", () => {
    const at = instant("2026-10-19T10:00:00Z");
    expect(
      Option.isNone(
        dueReservationActivityWindow("reservation-activity", at, at)
      )
    ).toBe(true);
  });

  it("truncates bounds to whole milliseconds", () => {
    expect(
      windowStrings(
        dueReservationActivityWindow(
          "reservation-activity",
          instant("2026-10-19T10:00:00.000123Z"),
          instant("2026-10-19T10:01:00.000999999Z")
        )
      )
    ).toEqual(["2026-10-19T09:58:00Z", "2026-10-19T10:01:00Z"]);
  });

  it("opens the reconcile on the first run of a new Workspace-local hour", () => {
    const sweptUntil = instant("2026-10-19T10:00:30Z");
    expect(
      Option.isNone(
        dueReservationActivityWindow(
          "reservation-activity-reconcile",
          sweptUntil,
          instant("2026-10-19T10:59:59Z")
        )
      )
    ).toBe(true);
    expect(
      windowStrings(
        dueReservationActivityWindow(
          "reservation-activity-reconcile",
          sweptUntil,
          instant("2026-10-19T11:00:10Z")
        )
      )
    ).toEqual(["2026-10-18T11:00:10Z", "2026-10-19T11:00:10Z"]);
  });
});

describe("chainedReservationActivityWindow", () => {
  const closed = {
    startsAt: instant("2026-10-19T03:58:00Z"),
    endsAt: instant("2026-10-19T10:00:00Z"),
  };

  it("chains the clock sweep while it lags more than a minute", () => {
    expect(
      windowStrings(
        chainedReservationActivityWindow(
          "reservation-activity",
          closed,
          instant("2026-10-19T10:01:01Z")
        )
      )
    ).toEqual(["2026-10-19T09:58:00Z", "2026-10-19T10:01:01Z"]);
  });

  it("leaves a sweep within a minute of now to the planner", () => {
    expect(
      Option.isNone(
        chainedReservationActivityWindow(
          "reservation-activity",
          closed,
          instant("2026-10-19T10:01:00Z")
        )
      )
    ).toBe(true);
  });

  it("never chains the reconcile", () => {
    expect(
      Option.isNone(
        chainedReservationActivityWindow(
          "reservation-activity-reconcile",
          closed,
          instant("2026-10-20T10:00:00Z")
        )
      )
    ).toBe(true);
  });
});
