import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import {
  CalendarExpression,
  canonicalCalendarExpression,
} from "./calendar-expression";

const decode = Schema.decodeUnknownResult(CalendarExpression);

describe("calendar expression contract", () => {
  test.each([
    { weekdays: ["monday"], hours: [10] },
    { minutes: [0, 30] },
    { months: [12] },
    { weeksOfYear: [1, 53], months: [1] },
    { daysOfMonth: [1, 31, "last"], hours: [0, 23], minutes: [0, 59] },
    {
      weekdayOccurrences: [
        { occurrence: 2, weekday: "tuesday" },
        { occurrence: "last", weekday: "friday" },
      ],
    },
    { minutes: Array.from({ length: 60 }, (_, minute) => minute) },
  ])("accepts %j", (input) => {
    expect(Result.getOrThrow(decode(input))).toEqual(input as never);
  });

  test.each([
    ["minute above 59", { minutes: [60] }],
    ["negative minute", { minutes: [-1] }],
    ["hour above 23", { hours: [24] }],
    ["fractional hour", { hours: [9.5] }],
    ["day of month 0", { daysOfMonth: [0] }],
    ["day of month 32", { daysOfMonth: [32] }],
    ["unknown day keyword", { daysOfMonth: ["first"] }],
    [
      "sixth occurrence",
      { weekdayOccurrences: [{ occurrence: 6, weekday: "monday" }] },
    ],
    ["week 0", { weeksOfYear: [0] }],
    ["week 54", { weeksOfYear: [54] }],
    ["month 13", { months: [13] }],
    ["unknown weekday", { weekdays: ["funday"] }],
  ])("rejects a %s", (_, input) => {
    expect(Result.isFailure(decode(input))).toBe(true);
  });

  test.each([
    ["minutes", { minutes: [0, 0] }],
    ["weekdays", { weekdays: ["monday", "monday"] }],
    ["days of month", { daysOfMonth: ["last", "last"] }],
    [
      "weekday occurrences",
      {
        weekdayOccurrences: [
          { occurrence: 2, weekday: "tuesday" },
          { occurrence: 2, weekday: "tuesday" },
        ],
      },
    ],
  ])("rejects duplicate %s", (_, input) => {
    expect(Result.isFailure(decode(input))).toBe(true);
  });

  test.each([
    ["no parts", {}],
    ["an empty list", { hours: [] }],
    ["an empty list beside a filled one", { hours: [9], minutes: [] }],
  ])("rejects %s", (_, input) => {
    expect(Result.isFailure(decode(input))).toBe(true);
  });

  test("orders fields and values canonically", () => {
    const expression = Result.getOrThrow(
      decode({
        months: [7, 1],
        weekdayOccurrences: [
          { occurrence: "last", weekday: "monday" },
          { occurrence: 2, weekday: "friday" },
          { occurrence: 2, weekday: "tuesday" },
        ],
        daysOfMonth: ["last", 15, 1],
        weekdays: ["sunday", "monday", "wednesday"],
        minutes: [30, 0],
      })
    );

    expect(JSON.stringify(canonicalCalendarExpression(expression))).toBe(
      JSON.stringify({
        minutes: [0, 30],
        weekdays: ["monday", "wednesday", "sunday"],
        daysOfMonth: [1, 15, "last"],
        weekdayOccurrences: [
          { occurrence: 2, weekday: "tuesday" },
          { occurrence: 2, weekday: "friday" },
          { occurrence: "last", weekday: "monday" },
        ],
        months: [1, 7],
      })
    );
  });
});
