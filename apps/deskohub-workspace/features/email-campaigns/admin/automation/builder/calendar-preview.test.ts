import { describe, expect, test } from "bun:test";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { AutomationScheduleMinutesNotAllowed } from "../../../automation/errors";
import { describeCampaignOperationFailure } from "../../campaign-operation-failure";
import {
  type CalendarPreviewView,
  calendarPreviewFailureCopy,
  calendarPreviewView,
  scheduleMinutesFailure,
  scheduleMinutesNotAllowedCopy,
} from "./calendar-preview";

const nextStarts = [
  "2026-11-02T09:00:00Z",
  "2026-11-09T09:00:00Z",
  "2026-11-16T09:00:00Z",
];
const frequency = { maxFiresPerHour: 4, firesMoreThanHourly: true };

describe("calendarPreviewView", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "formats each next start in order for %s and keeps the frequency",
    (locale) => {
      const view = calendarPreviewView(
        { description: "Every Monday", nextStarts, frequency },
        locale
      );
      expect(view).toEqual({
        _tag: "Ready",
        description: "Every Monday",
        nextStarts: nextStarts.map((start) =>
          formatAdministrationDateTime(start, locale)
        ),
        frequency,
      });
    }
  );
});

describe("scheduleMinutesFailure", () => {
  const failed = (code: string | undefined): CalendarPreviewView => ({
    _tag: "Failed",
    message: "Port refused the calendar",
    code,
  });

  test("returns the message of a refusal of the schedule's minutes", () => {
    expect(
      scheduleMinutesFailure(failed(AutomationScheduleMinutesNotAllowed.code))
    ).toBe("Port refused the calendar");
  });

  test.each([
    ["another refusal", failed("calendar-never-occurs")],
    ["a failure without a code", failed(undefined)],
    [
      "a ready preview",
      calendarPreviewView(
        { description: "Every Monday", nextStarts, frequency },
        "en-US"
      ),
    ],
    ["no preview", undefined],
  ] as const)("returns nothing for %s", (_, preview) => {
    expect(scheduleMinutesFailure(preview)).toBeUndefined();
  });
});

describe("calendarPreviewFailureCopy", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "words a minutes refusal like the minutes row in %s",
    (locale) => {
      const copy = describeCampaignOperationFailure(
        { code: AutomationScheduleMinutesNotAllowed.code },
        calendarPreviewFailureCopy,
        locale
      );
      expect(copy).toBe(scheduleMinutesNotAllowedCopy(locale));
    }
  );
});
