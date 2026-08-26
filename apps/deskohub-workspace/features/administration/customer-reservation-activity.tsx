import type { CSSProperties } from "react";
import { cn } from "@/shared/utils";
import type {
  AdministrationCustomerReservationActivity,
  AdministrationCustomerReservationActivityCategory,
} from "./administration.service";
import { formatAdministrationPlainDate } from "./formatters";

const reservationActivityCategoryStyles = {
  "cowork-basic": {
    className: "bg-aquamarine-green/25",
    label: "Basic",
  },
  "cowork-plus": {
    className: "bg-aquamarine-green/70",
    label: "Plus",
  },
  "cowork-profi": {
    className: "bg-aquamarine-ink",
    label: "Profi",
  },
  "meeting-room": {
    className: "bg-navy-blue",
    label: "Meeting room",
  },
  office: {
    className: "bg-burned-orange",
    label: "Office",
  },
} satisfies Record<
  AdministrationCustomerReservationActivityCategory,
  { readonly className: string; readonly label: string }
>;

export function CustomerReservationActivity({
  activity,
}: {
  readonly activity: AdministrationCustomerReservationActivity;
}) {
  const total = activity.dates?.reduce((sum, { count }) => sum + count, 0);

  return (
    <section className="mb-7" aria-labelledby="reservation-activity-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl" id="reservation-activity-heading">
          Reservation activity
        </h2>
        {total !== undefined && (
          <p className="text-sm text-navy-blue/65">
            {total} {total === 1 ? "reservation" : "reservations"} in the past
            365 days
          </p>
        )}
      </div>
      <div className="rounded-xl border border-navy-blue/10 bg-white p-4 sm:p-5">
        {activity.dates ? (
          <ReservationActivityGrid activity={activity} dates={activity.dates} />
        ) : (
          <p className="py-7 text-center text-sm text-navy-blue/65">
            Reservation activity is temporarily unavailable.
          </p>
        )}
      </div>
    </section>
  );
}

function ReservationActivityGrid({
  activity,
  dates,
}: {
  readonly activity: AdministrationCustomerReservationActivity;
  readonly dates: NonNullable<
    AdministrationCustomerReservationActivity["dates"]
  >;
}) {
  const from = Temporal.PlainDate.from(activity.from);
  const to = Temporal.PlainDate.from(activity.to);
  const days = Array.from({ length: from.until(to).days + 1 }, (_, index) =>
    from.add({ days: index })
  );
  const leadingDays = from.dayOfWeek % 7;
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
        date.toLocaleString("en-GB", { month: "short" })
      );
    }
  }

  return (
    <>
      <section
        aria-label="Reservation activity for the past 365 days"
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
              <span />
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
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
                const count = activity?.count ?? 0;
                const className = cn(
                  "block aspect-square w-full rounded-[3px] border border-navy-blue/8",
                  activity
                    ? reservationActivityCategoryStyles[activity.category]
                        .className
                    : "bg-navy-blue/[0.035]"
                );
                return (
                  <time
                    aria-hidden="true"
                    className={className}
                    dateTime={dateString}
                    key={dateString}
                    title={formatReservationActivityLabel(dateString, count)}
                  />
                );
              })}
            </div>
          </div>
        </div>
        <ul className="sr-only">
          {dates.map(({ count, date }) => (
            <li key={date}>{formatReservationActivityLabel(date, count)}</li>
          ))}
        </ul>
      </section>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs text-navy-blue/55">
        {Object.values(reservationActivityCategoryStyles).map(
          ({ className, label }) => (
            <span className="inline-flex items-center gap-1.5" key={label}>
              <span
                aria-hidden="true"
                className={cn(
                  "size-3 rounded-[3px] border border-navy-blue/8",
                  className
                )}
              />
              {label}
            </span>
          )
        )}
      </div>
    </>
  );
}

const formatReservationActivityLabel = (date: string, count: number) =>
  count === 0
    ? `No reservations on ${formatAdministrationPlainDate(date)}`
    : `${count} ${count === 1 ? "reservation" : "reservations"} on ${formatAdministrationPlainDate(date)}`;
