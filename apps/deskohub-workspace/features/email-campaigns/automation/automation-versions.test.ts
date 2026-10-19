import { describe, expect, test } from "bun:test";
import type {
  AutomationTriggerType as AutomationTrigger,
  CalendarExpressionType as CalendarExpression,
} from "@deskohub/workspace-admin-api";
import { Option } from "effect";
import type { AutomationVersionId } from "./automation-identifiers";
import {
  type AutomationVersionActivation,
  nextFireAfter,
  versionInForce,
} from "./automation-versions";

const timeZone = "Europe/Prague";

/** A Prague wall time ("2026-12-01T09:00") as an instant. */
const prague = (dateTime: string) =>
  Temporal.PlainDateTime.from(dateTime).toZonedDateTime(timeZone).toInstant();

const schedule = (calendar: CalendarExpression): AutomationTrigger => ({
  _tag: "Schedule",
  calendar,
});
const accountCreated: AutomationTrigger = { _tag: "AccountCreated" };

const version = (
  id: string,
  activatedAt: string,
  trigger: AutomationTrigger
): AutomationVersionActivation => ({
  id: id as AutomationVersionId,
  activatedAt: prague(activatedAt),
  trigger,
});

const daily10 = schedule({ hours: [10] });
const daily18 = schedule({ hours: [18] });

/** The fires from `after` until none is left or `count` are found. */
const fires = (
  versions: ReadonlyArray<AutomationVersionActivation>,
  after: Temporal.Instant,
  count: number
) => {
  const result: Temporal.Instant[] = [];
  let cursor = Option.some(after);
  while (Option.isSome(cursor) && result.length < count) {
    cursor = nextFireAfter(versions, cursor.value);
    if (Option.isSome(cursor)) {
      result.push(cursor.value);
    }
  }
  return result;
};

describe("versionInForce", () => {
  const v1 = version("v1", "2026-11-01T09:00", daily10);
  const v2 = version("v2", "2026-11-03T12:00", accountCreated);
  // Given out of order: the function orders by activation.
  const versions = [v2, v1];

  test("is none before the first activation", () => {
    expect(versionInForce(versions, prague("2026-11-01T08:59"))).toEqual(
      Option.none()
    );
  });

  test("is a version from its activation instant", () => {
    expect(versionInForce(versions, v1.activatedAt)).toEqual(Option.some(v1));
    expect(versionInForce(versions, v2.activatedAt)).toEqual(Option.some(v2));
  });

  test("is the latest activation before the time", () => {
    expect(versionInForce(versions, prague("2026-11-03T11:59"))).toEqual(
      Option.some(v1)
    );
    expect(versionInForce(versions, prague("2027-01-01T00:00"))).toEqual(
      Option.some(v2)
    );
  });
});

describe("nextFireAfter", () => {
  test("follows a single schedule version", () => {
    const versions = [version("v1", "2026-11-01T09:00", daily10)];
    expect(fires(versions, prague("2026-11-01T09:00"), 2)).toEqual([
      prague("2026-11-01T10:00"),
      prague("2026-11-02T10:00"),
    ]);
  });

  test("is strictly after the given time", () => {
    const versions = [version("v1", "2026-11-01T09:00", daily10)];
    expect(nextFireAfter(versions, prague("2026-11-02T10:00"))).toEqual(
      Option.some(prague("2026-11-03T10:00"))
    );
  });

  test("replays a backlog in order across a version activated mid-backlog", () => {
    const v1 = version("v1", "2026-11-01T09:00", daily10);
    const v2 = version("v2", "2026-11-03T12:00", daily18);
    const versions = [v1, v2];
    const replayed = fires(versions, prague("2026-11-02T00:00"), 4);
    expect(replayed).toEqual([
      prague("2026-11-02T10:00"),
      prague("2026-11-03T10:00"),
      prague("2026-11-03T18:00"),
      prague("2026-11-04T18:00"),
    ]);
    // Each fire follows the calendar of the version in force at it.
    expect(
      replayed.map((fire) =>
        Option.map(versionInForce(versions, fire), ({ id }) => id)
      )
    ).toEqual([
      Option.some("v1"),
      Option.some("v1"),
      Option.some("v2"),
      Option.some("v2"),
    ] as Option.Option<AutomationVersionId>[]);
  });

  test("gives a fire at the activation instant to the new version", () => {
    const versions = [
      version("v1", "2026-11-01T09:00", daily10),
      version("v2", "2026-11-03T18:00", daily18),
    ];
    expect(nextFireAfter(versions, prague("2026-11-03T10:00"))).toEqual(
      Option.some(prague("2026-11-03T18:00"))
    );
  });

  test("keeps the old calendar for fires before a newer activation", () => {
    const versions = [
      version("v1", "2026-11-01T09:00", daily10),
      version("v2", "2026-11-03T12:00", accountCreated),
    ];
    expect(nextFireAfter(versions, prague("2026-11-02T10:00"))).toEqual(
      Option.some(prague("2026-11-03T10:00"))
    );
  });

  test("is none once a non-schedule version takes over", () => {
    const versions = [
      version("v1", "2026-11-01T09:00", daily10),
      version("v2", "2026-11-03T12:00", accountCreated),
    ];
    expect(nextFireAfter(versions, prague("2026-11-03T10:00"))).toEqual(
      Option.none()
    );
  });

  test("starts firing when a schedule version replaces a non-schedule one", () => {
    const versions = [
      version("v1", "2026-11-01T09:00", accountCreated),
      version("v2", "2026-11-03T12:00", daily10),
    ];
    expect(nextFireAfter(versions, prague("2026-11-02T00:00"))).toEqual(
      Option.some(prague("2026-11-04T10:00"))
    );
  });

  test("passes over a non-schedule version between two schedules", () => {
    const versions = [
      version("v1", "2026-11-01T09:00", daily10),
      version("v2", "2026-11-02T12:00", accountCreated),
      version("v3", "2026-11-05T12:00", daily18),
    ];
    expect(fires(versions, prague("2026-11-02T00:00"), 2)).toEqual([
      prague("2026-11-02T10:00"),
      prague("2026-11-05T18:00"),
    ]);
  });

  test("starts at the first schedule activation when none is in force yet", () => {
    const versions = [version("v1", "2026-11-03T12:00", daily10)];
    expect(nextFireAfter(versions, prague("2026-11-01T00:00"))).toEqual(
      Option.some(prague("2026-11-04T10:00"))
    );
  });

  test("is none without versions", () => {
    expect(nextFireAfter([], prague("2026-11-01T00:00"))).toEqual(
      Option.none()
    );
  });
});
