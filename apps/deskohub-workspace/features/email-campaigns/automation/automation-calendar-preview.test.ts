import { describe, expect, test } from "bun:test";
import type { CalendarPreviewInputType as CalendarPreviewInput } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { previewCalendarExpression } from "./automation-calendar-preview";

const preview = (input: CalendarPreviewInput, now: string) =>
  Effect.runPromise(
    TestClock.setTime(Temporal.Instant.from(now).epochMilliseconds).pipe(
      Effect.andThen(previewCalendarExpression(input)),
      Effect.provide(TestClock.layer())
    )
  );

describe("previewCalendarExpression", () => {
  test("describes a trigger as a schedule and lists its next five starts", async () => {
    expect(
      await preview(
        {
          expression: { weekdays: ["monday"], hours: [10] },
          usage: "trigger",
          locale: "en-US",
        },
        "2026-10-19T12:00:00Z"
      )
    ).toEqual({
      description: "Every Monday at 10:00 (Prague time)",
      nextStarts: [
        "2026-10-26T09:00:00Z",
        "2026-11-02T09:00:00Z",
        "2026-11-09T09:00:00Z",
        "2026-11-16T09:00:00Z",
        "2026-11-23T09:00:00Z",
      ],
      frequency: { maxFiresPerHour: 1, firesMoreThanHourly: false },
    });
  });

  test("describes a wait as the period it waits for", async () => {
    const { description } = await preview(
      { expression: { months: [12] }, usage: "wait", locale: "en-US" },
      "2026-10-19T12:00:00Z"
    );

    expect(description).toStartWith("Waits until December");
  });

  test("keeps Prague midnight across the spring DST change", async () => {
    const { nextStarts } = await preview(
      { expression: { hours: [0] }, usage: "trigger", locale: "cs-CZ" },
      "2026-03-26T12:00:00Z"
    );

    expect(nextStarts).toEqual([
      "2026-03-26T23:00:00Z",
      "2026-03-27T23:00:00Z",
      "2026-03-28T23:00:00Z",
      "2026-03-29T22:00:00Z",
      "2026-03-30T22:00:00Z",
    ]);
  });

  test("flags a schedule that fires more than hourly", async () => {
    const { description, nextStarts, frequency } = await preview(
      { expression: { minutes: [0, 30] }, usage: "trigger", locale: "en-US" },
      "2026-10-19T12:10:00Z"
    );

    expect(description).toBe("Every hour at :00 and :30 (Prague time)");
    expect(nextStarts).toEqual([
      "2026-10-19T12:30:00Z",
      "2026-10-19T13:00:00Z",
      "2026-10-19T13:30:00Z",
      "2026-10-19T14:00:00Z",
      "2026-10-19T14:30:00Z",
    ]);
    expect(frequency).toEqual({
      maxFiresPerHour: 2,
      firesMoreThanHourly: true,
    });
  });

  test("fails an expression that never occurs", async () => {
    const error = await Effect.runPromise(
      previewCalendarExpression({
        expression: { daysOfMonth: [31], months: [2] },
        usage: "trigger",
        locale: "en-US",
      }).pipe(Effect.flip)
    );

    expect(error._tag).toBe("CalendarExpressionNeverOccurs");
  });
});
