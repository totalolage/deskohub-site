import "server-only";

import { DotyposService } from "@deskohub/dotypos";
import { Effect } from "effect";
import "@/shared/polyfills/temporal";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { readSharedSnapshot } from "@/shared/backend/shared-snapshot";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { type FaqOccupancyStats, getFaqOccupancyStats } from "./faq-occupancy";

const loadFaqOccupancy = Effect.fn("FaqOccupancy.load")(function* () {
  const now = Temporal.Now.instant();
  const reservationBounds = getPreviousCompleteMonthBounds(now);
  const dotypos = yield* DotyposService;
  const [tables, reservations] = yield* Effect.all(
    [dotypos.getTables(), dotypos.listReservations(reservationBounds)],
    { concurrency: "inherit" }
  );

  return yield* getFaqOccupancyStats({ now, reservations, tables });
});

/**
 * The life of the stats a Dotypos outage left unknown: refreshed within a
 * minute, with the expiry at the 5-minute prerender threshold so the FAQ
 * page stays in the static shell.
 */
const unknownOccupancyLife = { stale: 30, revalidate: 60, expire: 300 };

/**
 * Last month's occupancy, or undefined when Dotypos or the Workspace runtime
 * can't provide it: under Cache Components a throwing "use cache" function
 * fails the prerender even when the caller catches it.
 */
export async function loadFaqOccupancyStats(): Promise<
  FaqOccupancyStats | undefined
> {
  "use cache";

  return await readSharedSnapshot(
    "faq.occupancy.load",
    loadFaqOccupancy().pipe(
      Effect.map(
        (stats): FaqOccupancyStats => ({
          averageReservationsPerDay: stats.averageReservationsPerDay,
          coworkSeatCapacity: stats.coworkSeatCapacity,
        })
      ),
      Effect.provide(WorkspaceDotyposLayer)
    ),
    {
      boundary: "page",
      complete: { lifetime: { stale: 30, revalidate: 300, expire: 600 } },
      failure: {
        failureCode: "faq.occupancy.load_failed",
        fallback: () => undefined,
        lifetime: unknownOccupancyLife,
      },
    }
  );
}

const getPreviousCompleteMonthBounds = (now: Temporal.Instant) => {
  const timeZone = workspaceSiteConstants.location.timeZone;
  const localNow = now.toZonedDateTimeISO(timeZone);
  const currentMonthStart = Temporal.PlainDate.from({
    year: localNow.year,
    month: localNow.month,
    day: 1,
  });

  return {
    startsAtOrAfter: currentMonthStart
      .subtract({ months: 1 })
      .toZonedDateTime({ timeZone })
      .toInstant()
      .toString(),
    startsBefore: currentMonthStart
      .toZonedDateTime({ timeZone })
      .toInstant()
      .toString(),
  };
};
