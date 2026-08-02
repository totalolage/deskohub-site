import { CalendarClock } from "lucide-react";
import { Suspense } from "react";
import { getLocale, m } from "@/features/i18n";
import { formatDate } from "@/shared/utils/date-formatting";
import {
  getWeekdayHours,
  getWeekendHours,
} from "@/shared/utils/working-hours-helpers";
import { getUpcomingOpeningHoursExceptions } from "../backend/get-upcoming-opening-hours-exceptions";
import type { OpeningHoursException } from "../backend/opening-hours-calendar.service";

export function OpeningHours() {
  const weekdayHours = getWeekdayHours();
  const weekendHours = getWeekendHours();

  return (
    <>
      <div className="mt-12 flex flex-col items-center justify-center gap-4 md:flex-row md:gap-8">
        <div className="rounded-lg bg-white/10 p-4 backdrop-blur-sm">
          <div className="text-sm text-green-400">{m["hours.weekdays"]()}</div>
          <div className="text-lg font-semibold">
            {weekdayHours.open}-{weekdayHours.close}
          </div>
        </div>
        <div className="rounded-lg bg-white/10 p-4 backdrop-blur-sm">
          <div className="text-sm text-green-400">{m["hours.weekends"]()}</div>
          <div className="text-lg font-semibold">
            {weekendHours.open}-{weekendHours.close}
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        <UpcomingOpeningHoursExceptions />
      </Suspense>
    </>
  );
}

async function UpcomingOpeningHoursExceptions() {
  const exceptions = await getUpcomingOpeningHoursExceptions();

  if (exceptions.length === 0) {
    return null;
  }

  return (
    <section className="mx-auto mt-5 max-w-3xl rounded-xl border border-amber-200/30 bg-black/40 p-4 text-left backdrop-blur-sm">
      <h2 className="flex items-center justify-center gap-2 font-semibold text-amber-200 text-sm uppercase tracking-[0.14em]">
        <CalendarClock aria-hidden="true" className="size-4" />
        {m["hours.exceptionsTitle"]()}
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {exceptions.map((exception) => (
          <li
            className="rounded-lg bg-white/10 px-3 py-2 text-sm"
            key={getExceptionKey(exception)}
          >
            <span className="font-semibold text-white">
              {formatExceptionDate(exception.date)}
            </span>
            <span className="mx-2 text-white/50">·</span>
            <OpeningHoursExceptionValue exception={exception} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpeningHoursExceptionValue({
  exception,
}: {
  exception: OpeningHoursException;
}) {
  if (exception._tag === "Closed") {
    return (
      <span className="font-semibold text-amber-200">
        {m["hours.closed"]()}
      </span>
    );
  }

  return (
    <span className="text-white/90">
      {exception.ongoing ? (
        <span className="mr-2 font-semibold text-green-400">
          {m["hours.ongoing"]()}
        </span>
      ) : null}
      {exception.opensAt}-{exception.closesAt}
      {exception.closesNextDay ? (
        <span className="ml-1 text-white/60">({m["hours.nextDay"]()})</span>
      ) : null}
    </span>
  );
}

const formatExceptionDate = (date: string) =>
  formatDate(`${date}T12:00:00.000Z`, getLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const getExceptionKey = (exception: OpeningHoursException) =>
  exception._tag === "Closed"
    ? `closed:${exception.date}`
    : `hours:${exception.date}:${exception.opensAt}:${exception.closesAt}`;
