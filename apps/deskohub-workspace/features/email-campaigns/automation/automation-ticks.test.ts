import { describe, expect, test } from "bun:test";
import {
  automationTickAfter,
  automationTickAtOrAfter,
  automationTickBefore,
} from "./automation-ticks";

const at = (instant: string) => Temporal.Instant.from(instant);

describe("automation ticks", () => {
  test.each([
    ["2026-10-21T10:00:00Z", "2026-10-21T10:00:00Z"],
    ["2026-10-21T10:00:00.000001Z", "2026-10-21T10:15:00Z"],
    ["2026-10-21T10:07:00Z", "2026-10-21T10:15:00Z"],
    ["2026-10-21T10:52:30Z", "2026-10-21T11:00:00Z"],
    ["2026-10-21T23:59:00Z", "2026-10-22T00:00:00Z"],
  ])("the first tick at or after %s is %s", (instant, tick) => {
    expect(automationTickAtOrAfter(at(instant))).toEqual(at(tick));
  });

  test("ticks on the quarter hours in Prague time too", () => {
    const tick = automationTickAtOrAfter(at("2026-10-21T08:22:00Z"));
    expect(tick.toZonedDateTimeISO("Europe/Prague").minute).toBe(30);
  });

  test("steps one tick from the tick at or after an instant", () => {
    expect(automationTickAfter(at("2026-10-21T10:15:00Z"))).toEqual(
      at("2026-10-21T10:30:00Z")
    );
    expect(automationTickAfter(at("2026-10-21T10:07:00Z"))).toEqual(
      at("2026-10-21T10:30:00Z")
    );
    expect(automationTickBefore(at("2026-10-21T10:07:00Z"))).toEqual(
      at("2026-10-21T10:00:00Z")
    );
  });
});
