import { Effect, Match } from "effect";
import { CalendarClock } from "lucide-react";
import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { getLocale, type Locale, m } from "@/features/i18n";
import { GlassCard } from "@/shared/components/ui/glass-card";
import { applyCacheTags, openingHoursTags } from "@/shared/utils/cache-tags";
import { formatDate } from "@/shared/utils/date-formatting";
import {
  getWeekdayHours,
  getWeekendHours,
} from "@/shared/utils/working-hours-helpers";
import { getUpcomingOpeningHoursExceptions } from "../backend/get-upcoming-opening-hours-exceptions";
import {
  getOpeningHoursExceptionKey,
  type OpeningHoursException,
} from "../backend/opening-hours-calendar.service";

export function OpeningHours() {
  const locale = getLocale();
  const weekdayHours = getWeekdayHours();
  const weekendHours = getWeekendHours();

  return (
    <>
      <div className="mt-12 flex flex-col items-center justify-center gap-4 md:flex-row md:gap-8">
        <GlassCard
          className="min-w-38 rounded-2xl border border-white/25 bg-black/60 px-6 py-4 shadow-[0_18px_48px_-24px_rgba(0,0,0,0.9)]"
          optics={{ frost: 2 }}
        >
          <div className="text-sm text-green-400">{m["hours.weekdays"]()}</div>
          <div className="text-lg font-semibold">
            {weekdayHours.open}-{weekdayHours.close}
          </div>
        </GlassCard>
        <GlassCard
          className="min-w-38 rounded-2xl border border-white/25 bg-black/60 px-6 py-4 shadow-[0_18px_48px_-24px_rgba(0,0,0,0.9)]"
          optics={{ frost: 2 }}
        >
          <div className="text-sm text-green-400">{m["hours.weekends"]()}</div>
          <div className="text-lg font-semibold">
            {weekendHours.open}-{weekendHours.close}
          </div>
        </GlassCard>
      </div>
      <Suspense fallback={null}>
        <UpcomingOpeningHoursExceptions locale={locale} />
      </Suspense>
    </>
  );
}

async function UpcomingOpeningHoursExceptions({ locale }: { locale: Locale }) {
  try {
    return await CachedUpcomingOpeningHoursExceptions({ locale });
  } catch (cause) {
    await Effect.runPromise(
      Effect.logError(
        "Upcoming opening-hours exceptions are unavailable; using regular hours",
        { cause }
      )
    );
    return null;
  }
}

async function CachedUpcomingOpeningHoursExceptions({
  locale,
}: {
  locale: Locale;
}) {
  "use cache";

  cacheLife({ stale: Infinity, revalidate: Infinity, expire: Infinity });
  applyCacheTags(openingHoursTags.exceptions());

  const exceptions = await getUpcomingOpeningHoursExceptions();

  if (exceptions.length === 0) {
    return null;
  }

  return (
    <GlassCard
      aria-labelledby="opening-hours-exceptions-title"
      className="mx-auto mt-5 max-w-3xl rounded-2xl border border-amber-100/30 bg-black/70 p-4 text-left shadow-[0_24px_64px_-32px_rgba(0,0,0,0.95)]"
      optics={{ frost: 2 }}
      role="region"
    >
      <h2
        className="flex items-center justify-center gap-2 font-semibold text-amber-200 text-sm uppercase tracking-[0.14em]"
        id="opening-hours-exceptions-title"
      >
        <CalendarClock aria-hidden="true" className="size-4" />
        {m["hours.exceptionsTitle"]({}, { locale })}
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {exceptions.map((exception) => (
          <li
            className="rounded-lg bg-white/10 px-3 py-2 text-sm"
            key={getOpeningHoursExceptionKey(exception)}
          >
            <span className="font-semibold text-white">
              {formatExceptionDate(exception.date, locale)}
            </span>
            <span className="mx-2 text-white/50">·</span>
            <OpeningHoursExceptionValue exception={exception} locale={locale} />
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function OpeningHoursExceptionValue({
  exception,
  locale,
}: {
  exception: OpeningHoursException;
  locale: Locale;
}) {
  return Match.value(exception).pipe(
    Match.tagsExhaustive({
      Closed: () => (
        <span className="font-semibold text-amber-200">
          {m["hours.closed"]({}, { locale })}
        </span>
      ),
      SpecialHours: ({ closesAt, closesNextDay, opensAt }) => (
        <span className="text-white/90">
          {formatExceptionTime(opensAt)}-{formatExceptionTime(closesAt)}
          {closesNextDay && (
            <span className="ml-1 text-white/60">
              ({m["hours.nextDay"]({}, { locale })})
            </span>
          )}
        </span>
      ),
    })
  );
}

const formatExceptionDate = (date: Temporal.PlainDate, locale: Locale) =>
  formatDate(`${date}T12:00:00.000Z`, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const formatExceptionTime = (time: Temporal.PlainTime) =>
  time.toString({ smallestUnit: "minute" });
