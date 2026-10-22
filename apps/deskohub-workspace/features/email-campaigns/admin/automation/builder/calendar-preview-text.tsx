import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { cn } from "@/shared/utils";
import type { CalendarPreviewView } from "./calendar-preview";

/**
 * The port's plain-English reading of a calendar, as grey text under its
 * editor (D11), or why the port refused it.
 */
export function CalendarPreviewText({
  preview,
  pending,
}: {
  readonly preview: CalendarPreviewView | undefined;
  readonly pending: boolean;
}) {
  return (
    <p
      aria-live="polite"
      className={cn(
        "text-sm leading-6 transition-opacity",
        preview?._tag === "Failed" ? "text-burned-orange" : "text-navy-blue/55",
        pending && "opacity-60"
      )}
    >
      {preview?._tag === "Ready" && preview.description}
      {preview?._tag === "Failed" && preview.message}
    </p>
  );
}

/** A schedule's next fires in Prague time, small. */
export function CalendarNextStarts({
  preview,
  locale,
}: {
  readonly preview: CalendarPreviewView | undefined;
  readonly locale: Locale;
}) {
  return (
    preview?._tag === "Ready" &&
    preview.nextStarts.length > 0 && (
      <div className="text-navy-blue/55 text-xs">
        <p className="font-semibold uppercase tracking-[0.1em]">
          {m.emailAutomationFlowCalendarNextFires({}, { locale })}
        </p>
        <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
          {preview.nextStarts.map((start) => (
            <li key={start}>{start}</li>
          ))}
        </ol>
      </div>
    )
  );
}
