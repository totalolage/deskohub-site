import {
  type CalendarPreviewType as CalendarPreview,
  type CalendarPreviewInputType as CalendarPreviewInput,
  emailAutomationScheduleMinutes,
} from "@deskohub/workspace-admin-api";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { CampaignOperationFailureCopy } from "../../campaign-operation-failure";

/** Whether a calendar is a schedule trigger's or a wait step's. */
export type CalendarUsage = CalendarPreviewInput["usage"];

/**
 * How the builder shows one calendar: the port's sentence, its next starts
 * as Prague date-times, and its frequency, or why the port refused it.
 */
export type CalendarPreviewView =
  | {
      readonly _tag: "Ready";
      readonly description: string;
      readonly nextStarts: readonly string[];
      readonly frequency: CalendarPreview["frequency"];
    }
  | {
      readonly _tag: "Failed";
      readonly message: string;
      /** The port's failure code, when the port refused the calendar. */
      readonly code: string | undefined;
    };

/** The port's preview, with its starts formatted for `locale`. */
export const calendarPreviewView = (
  { description, nextStarts, frequency }: CalendarPreview,
  locale: Locale
): CalendarPreviewView => ({
  _tag: "Ready",
  description,
  nextStarts: nextStarts.map((start) =>
    formatAdministrationDateTime(start, locale)
  ),
  frequency,
});

/**
 * The port refuses a schedule trigger off the engine's ticks (D36), both in
 * its preview and when the flow is saved; the builder shows it at the
 * minutes.
 */
export const scheduleMinutesNotAllowedCode = "schedule-minutes-not-allowed";

export const scheduleMinutesNotAllowedCopy = (locale: Locale) =>
  m.emailAutomationFlowScheduleMinutesNotAllowed(
    {
      minutes: emailAutomationScheduleMinutes
        .map((minute) => `:${minute.toString().padStart(2, "0")}`)
        .join(", "),
    },
    { locale }
  );

export const calendarPreviewFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailAutomationFlowCalendarPreviewUnavailable({}, { locale }),
  codes: {
    "calendar-never-occurs": (locale) =>
      m.emailAutomationFlowCalendarNeverOccurs({}, { locale }),
    [scheduleMinutesNotAllowedCode]: scheduleMinutesNotAllowedCopy,
  },
};

/** Why the port refused a schedule's minutes, if that is why it failed. */
export const scheduleMinutesFailure = (
  preview: CalendarPreviewView | undefined
) =>
  preview?._tag === "Failed" && preview.code === scheduleMinutesNotAllowedCode
    ? preview.message
    : undefined;
