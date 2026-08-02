import "server-only";

import { Temporal } from "@js-temporal/polyfill";
import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { siteConstants } from "@/shared/utils/constants";
import { OpeningHoursCalendarServiceLive } from "./opening-hours-calendar.runtime";
import {
  OpeningHoursCalendarService,
  type OpeningHoursException,
} from "./opening-hours-calendar.service";

const upcomingWindowDays = 90;
const maximumDisplayedExceptions = 6;

export async function getUpcomingOpeningHoursExceptions(): Promise<
  readonly OpeningHoursException[]
> {
  "use cache";

  cacheLife({
    stale: 300,
    revalidate: 300,
    expire: 3600,
  });

  const now = Temporal.Now.instant();
  const today = now
    .toZonedDateTimeISO(siteConstants.workingHours.timezone)
    .toPlainDate();
  const query = {
    from: today.toString(),
    to: today.add({ days: upcomingWindowDays }).toString(),
    now: now.toString(),
  };

  const loadExceptions = Effect.gen(function* () {
    const openingHoursCalendar = yield* OpeningHoursCalendarService;
    return yield* openingHoursCalendar.listExceptions(query);
  }).pipe(
    Effect.provide(OpeningHoursCalendarServiceLive),
    Effect.catch((cause) =>
      Effect.logError(
        "Upcoming opening-hours exceptions are unavailable; using regular hours",
        { cause }
      ).pipe(Effect.as([] as readonly OpeningHoursException[]))
    ),
    Effect.map((exceptions) => exceptions.slice(0, maximumDisplayedExceptions))
  );

  return Effect.runPromise(loadExceptions);
}
