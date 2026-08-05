import "server-only";

import { Effect } from "effect";
import { siteConstants } from "@/shared/utils/constants";
import {
  OpeningHoursCalendarService,
  type OpeningHoursException,
} from "./opening-hours-calendar.service";

const upcomingWindowDays = 90;
const maximumDisplayedExceptions = 6;

export async function getUpcomingOpeningHoursExceptions(): Promise<
  readonly OpeningHoursException[]
> {
  const now = Temporal.Now.instant();
  const today = now
    .toZonedDateTimeISO(siteConstants.workingHours.timezone)
    .toPlainDate();
  const query = {
    from: today,
    to: today.add({ days: upcomingWindowDays }),
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
