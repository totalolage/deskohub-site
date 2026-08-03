import "server-only";

import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { applyCacheTags, openingHoursTags } from "@/shared/utils/cache-tags";
import { siteConstants } from "@/shared/utils/constants";
import {
  OpeningHoursCalendarService,
  type OpeningHoursException,
} from "./opening-hours-calendar.service";

const upcomingWindowDays = 90;
const maximumDisplayedExceptions = 6;

async function loadUpcomingOpeningHoursExceptions(): Promise<
  readonly OpeningHoursException[]
> {
  "use cache";

  cacheLife({ stale: Infinity, revalidate: Infinity, expire: Infinity });
  applyCacheTags(openingHoursTags.exceptions());

  const now = Temporal.Now.instant();
  const today = now
    .toZonedDateTimeISO(siteConstants.workingHours.timezone)
    .toPlainDate();
  const query = {
    from: today.toString(),
    to: today.add({ days: upcomingWindowDays }).toString(),
  };

  const loadExceptions = Effect.gen(function* () {
    const openingHoursCalendar = yield* OpeningHoursCalendarService;
    return yield* openingHoursCalendar.listExceptions(query);
  }).pipe(
    Effect.provide(OpeningHoursCalendarService.LiveWithDependencies),
    Effect.map((exceptions) => exceptions.slice(0, maximumDisplayedExceptions))
  );

  return Effect.runPromise(loadExceptions);
}

export async function getUpcomingOpeningHoursExceptions(): Promise<
  readonly OpeningHoursException[]
> {
  try {
    return await loadUpcomingOpeningHoursExceptions();
  } catch (cause) {
    await Effect.runPromise(
      Effect.logError(
        "Upcoming opening-hours exceptions are unavailable; using regular hours",
        { cause }
      )
    );
    return [];
  }
}
