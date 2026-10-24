import type { CSSProperties, ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { cn } from "@/shared/utils";
import { formatWeekday } from "@/shared/utils/date-time-format";
import type {
  AdministrationReservationActivity,
  AdministrationReservationActivityDate,
} from "./administration.service";
import { formatAdministrationPlainDate } from "./formatters";
import { m } from "./i18n";

export type ReservationActivityDayAppearance = {
  readonly className?: string;
  readonly style?: CSSProperties;
};

/** The reservation count at which a day is filled halfway. */
const halfIntensityReservationCount = 6;

/**
 * Maps a day's reservation count to a fill between 0 and 1. The curve
 * `1 - 2^(-count / 6)` leaves an empty day unfilled, fills a day with six
 * reservations halfway, and approaches a full fill as the count grows, so a
 * busy day never saturates the scale.
 */
export const getReservationActivityIntensity = (count: number) =>
  count <= 0 ? 0 : 1 - 2 ** (-count / halfIntensityReservationCount);

/** Fills a day with the brand green at the count's intensity. */
export const getReservationActivityCountAppearance = (
  count: number
): ReservationActivityDayAppearance => {
  const intensity = getReservationActivityIntensity(count);
  return intensity === 0
    ? { className: emptyDayClassName }
    : {
        className: "bg-aquamarine-green/(--reservation-activity-intensity)",
        style: {
          "--reservation-activity-intensity": `${
            Math.round(intensity * 1000) / 10
          }%`,
        } as CSSProperties,
      };
};

const emptyDayClassName = "bg-navy-blue/[0.035]";

export function ReservationActivitySwatch({
  className,
  style,
}: ReservationActivityDayAppearance) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-3 border border-navy-blue/8", className)}
      style={style}
    />
  );
}

export function ReservationActivityTotal({
  activity,
  locale,
}: {
  readonly activity: AdministrationReservationActivity;
  readonly locale: Locale;
}) {
  if (!activity.dates) return null;
  const total = activity.dates.reduce((sum, { count }) => sum + count, 0);
  return (
    <p className="text-sm text-navy-blue/65">
      {m.administrationReservationActivityYearTotal(
        { count: total },
        { locale }
      )}
    </p>
  );
}

/**
 * A year of reservation activity in Monday-first week columns. Each caller
 * decides how a day with reservations looks and supplies the matching legend.
 */
export function ReservationActivityCalendar<
  TDate extends AdministrationReservationActivityDate,
>({
  activity,
  getDayAppearance,
  legend,
  locale,
}: {
  readonly activity: AdministrationReservationActivity<TDate>;
  readonly getDayAppearance: (date: TDate) => ReservationActivityDayAppearance;
  readonly legend: ReactNode;
  readonly locale: Locale;
}) {
  return (
    <div className="rounded-xl border border-navy-blue/10 bg-white p-4 sm:p-5">
      {activity.dates ? (
        <>
          <ReservationActivityGrid
            dates={activity.dates}
            from={activity.from}
            getDayAppearance={getDayAppearance}
            locale={locale}
            to={activity.to}
          />
          <div className="mt-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs text-navy-blue/55">
            {legend}
          </div>
        </>
      ) : (
        <p className="py-7 text-center text-sm text-navy-blue/65">
          {m.administrationReservationActivityUnavailable({}, { locale })}
        </p>
      )}
    </div>
  );
}

function ReservationActivityGrid<
  TDate extends AdministrationReservationActivityDate,
>({
  dates,
  from: fromDate,
  getDayAppearance,
  locale,
  to: toDate,
}: {
  readonly dates: readonly TDate[];
  readonly from: string;
  readonly getDayAppearance: (date: TDate) => ReservationActivityDayAppearance;
  readonly locale: Locale;
  readonly to: string;
}) {
  const from = Temporal.PlainDate.from(fromDate);
  const to = Temporal.PlainDate.from(toDate);
  const days = Array.from({ length: from.until(to).days + 1 }, (_, index) =>
    from.add({ days: index })
  );
  // ISO weekdays run from Monday (1) to Sunday (7), so each column starts on
  // a Monday.
  const leadingDays = from.dayOfWeek - 1;
  const weekCount = Math.ceil((leadingDays + days.length) / 7);
  const leadingDates = Array.from({ length: leadingDays }, (_, index) =>
    from.subtract({ days: leadingDays - index }).toString()
  );
  const weekStarts = Array.from({ length: weekCount }, (_, week) =>
    from
      .subtract({ days: leadingDays })
      .add({ days: week * 7 })
      .toString()
  );
  const gridStyle = {
    gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
  } satisfies CSSProperties;
  const activityByDate = new Map(dates.map((date) => [date.date, date]));
  const monthLabels = new Map<number, string>();
  for (const [index, date] of days.entries()) {
    if (date.day === 1) {
      monthLabels.set(
        Math.floor((leadingDays + index) / 7),
        date.toLocaleString(locale, { month: "short" })
      );
    }
  }

  return (
    <section
      aria-label={m.administrationReservationActivityCalendarLabel(
        {},
        { locale }
      )}
      className="overflow-x-auto rounded-lg"
    >
      <div className="min-w-[50rem]">
        <div className="mb-1 grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2">
          <span />
          <div
            className="grid gap-1 text-xs text-navy-blue/55"
            style={gridStyle}
          >
            {weekStarts.map((weekStart, week) => (
              <span className="whitespace-nowrap" key={weekStart}>
                {monthLabels.get(week)}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2">
          <div
            aria-hidden="true"
            className="grid grid-rows-7 gap-1 text-xs leading-none text-navy-blue/55"
          >
            <span>{formatWeekday({ isoDay: 1, locale })}</span>
            <span />
            <span>{formatWeekday({ isoDay: 3, locale })}</span>
            <span />
            <span>{formatWeekday({ isoDay: 5, locale })}</span>
            <span />
            <span />
          </div>
          <div
            className="grid grid-flow-col grid-rows-7 gap-1"
            style={gridStyle}
          >
            {leadingDates.map((date) => (
              <span aria-hidden="true" key={date} />
            ))}
            {days.map((date) => {
              const dateString = date.toString();
              const activity = activityByDate.get(dateString);
              const appearance = activity
                ? getDayAppearance(activity)
                : { className: emptyDayClassName };
              return (
                <time
                  aria-hidden="true"
                  className={cn(
                    "block aspect-square w-full border border-navy-blue/8",
                    appearance.className
                  )}
                  dateTime={dateString}
                  key={dateString}
                  style={appearance.style}
                  title={formatReservationActivityLabel(
                    dateString,
                    activity?.count ?? 0,
                    locale
                  )}
                />
              );
            })}
          </div>
        </div>
      </div>
      <ul className="sr-only">
        {dates.map(({ count, date }) => (
          <li key={date}>
            {formatReservationActivityLabel(date, count, locale)}
          </li>
        ))}
      </ul>
    </section>
  );
}

const formatReservationActivityLabel = (
  date: string,
  count: number,
  locale: Locale
) => {
  const formattedDate = formatAdministrationPlainDate(date, locale);
  return count === 0
    ? m.administrationReservationActivityDayEmpty(
        { date: formattedDate },
        { locale }
      )
    : m.administrationReservationActivityDay(
        { count, date: formattedDate },
        { locale }
      );
};
