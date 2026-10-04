import "server-only";

import { DotyposService } from "@deskohub/dotypos";
import { Effect } from "effect";
import { cacheLife } from "next/cache";
import "@/shared/polyfills/temporal";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
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

export async function loadFaqOccupancyStats(): Promise<FaqOccupancyStats> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 300, expire: 600 });

  const stats = await loadFaqOccupancy().pipe(
    Effect.provide(WorkspaceDotyposLayer),
    runWorkspaceEffect("faq.occupancy.load", { boundary: "page" })
  );

  return {
    averageReservationsPerDay: stats.averageReservationsPerDay,
    coworkSeatCapacity: stats.coworkSeatCapacity,
  };
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
