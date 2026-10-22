import { describe, expect, test } from "bun:test";
import {
  automationTickAtOrAfter,
  automationTickAtOrBefore,
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

  test.each([
    ["2026-10-21T10:00:00Z", "2026-10-21T10:00:00Z"],
    ["2026-10-21T10:00:40Z", "2026-10-21T10:00:00Z"],
    ["2026-10-21T10:14:59.999Z", "2026-10-21T10:00:00Z"],
    ["2026-10-21T10:15:00Z", "2026-10-21T10:15:00Z"],
    ["2026-10-22T00:07:00Z", "2026-10-22T00:00:00Z"],
  ])("the tick at or before %s is %s", (instant, tick) => {
    expect(automationTickAtOrBefore(at(instant))).toEqual(at(tick));
  });
});
