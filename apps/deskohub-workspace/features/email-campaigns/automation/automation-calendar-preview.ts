import type {
  CalendarExpressionType as CalendarExpression,
  CalendarPreviewType as CalendarPreview,
  CalendarPreviewInputType as CalendarPreviewInput,
} from "@deskohub/workspace-admin-api";
import { Effect, Option } from "effect";
import {
  calendarFrequency,
  nextStart,
  nextStartWithinHorizon,
} from "@/shared/utils/calendar-expression";
import { currentInstant } from "@/shared/utils/temporal";
import {
  type CalendarExpressionUsage,
  describeCalendarExpression,
} from "../admin/calendar-expression-phrases";
import { ensureScheduleOnTicks } from "./automation-flow";

/** Period starts a preview lists. */
const previewedStarts = 5;

/**
 * How a schedule trigger or a wait step would read an expression: its
 * sentence in the requested locale, its next five period starts after now,
 * and how often it can fire. An expression without a start in the next
 * eight years fails `CalendarExpressionNeverOccurs`, and a trigger off the
 * engine's ticks fails `AutomationScheduleMinutesNotAllowed`, as saving the
 * flow would.
 */
export const previewCalendarExpression = Effect.fn(
  "AutomationCalendar.preview"
)(function* ({ expression, usage, locale }: CalendarPreviewInput) {
  if (usage === "trigger") {
    yield* ensureScheduleOnTicks(expression);
  }
  const now = yield* currentInstant;
  const first = yield* nextStart(expression, now);
  const preview: CalendarPreview = {
    description: describeCalendarExpression(
      expression,
      phrasedUsage[usage],
      locale
    ),
    nextStarts: successiveStarts(expression, first).map((start) =>
      start.toString()
    ),
    frequency: calendarFrequency(expression),
  };
  return preview;
});

/** A trigger reads as a schedule: it names when each period starts. */
const phrasedUsage = {
  trigger: "schedule",
  wait: "wait",
} as const satisfies Record<
  CalendarPreviewInput["usage"],
  CalendarExpressionUsage
>;

/**
 * `first` and the starts that follow it, up to the preview's count; fewer
 * when the next start lies beyond the horizon.
 */
const successiveStarts = (
  expression: CalendarExpression,
  first: Temporal.Instant
) => {
  const starts = [first];
  for (
    let next = nextStartWithinHorizon(expression, first);
    starts.length < previewedStarts && Option.isSome(next);
    next = nextStartWithinHorizon(expression, next.value)
  ) {
    starts.push(next.value);
  }
  return starts;
};
