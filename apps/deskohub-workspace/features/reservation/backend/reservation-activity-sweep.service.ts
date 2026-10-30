import { and, eq, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { customerEventSweeps } from "@/db/schema";
import type { NewCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import { recordCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import {
  chainedReservationActivityWindow,
  dueReservationActivityWindow,
  type ReservationActivityPage,
  type ReservationActivityWindow,
} from "./reservation-activity-sweep-window";
import {
  type ReservationVisit,
  ReservationVisits,
  type ReservationVisitsUnavailable,
} from "./reservation-visits.service";

/** One fetched page: in-memory facts only, never persisted. */
export type ReservationActivityFetch = {
  readonly visits: ReadonlyArray<ReservationVisit>;
  readonly hasNextPage: boolean;
};

interface IReservationActivitySweep {
  /**
   * The page each source should fetch next: the saved page of an open
   * window, or page 1 of a window opened now by CAS. Overlapping callers
   * open a window once.
   */
  readonly duePages: (
    at: Temporal.Instant
  ) => Effect.Effect<
    ReadonlyArray<ReservationActivityPage>,
    EffectDrizzleQueryError,
    WorkspaceTransaction
  >;
  /**
   * Fetches one page with a single `ReservationVisits` request. Visits are
   * memoised per invocation, so the caller provides a fresh
   * `ReservationVisits` for every page.
   */
  readonly fetchPage: (
    page: ReservationActivityPage
  ) => Effect.Effect<
    ReservationActivityFetch,
    ReservationVisitsUnavailable,
    ReservationVisits
  >;
  /**
   * Records the page's started and finished events at `at`, sampled after
   * the fetch, and advances the cursor by CAS. Returns the page to fetch
   * next, if any; none when the cursor has already moved past this page.
   */
  readonly commitPage: (
    page: ReservationActivityPage,
    fetched: ReservationActivityFetch,
    at: Temporal.Instant
  ) => Effect.Effect<
    Option.Option<ReservationActivityPage>,
    EffectDrizzleQueryError,
    WorkspaceTransaction
  >;
}

/**
 * Records `reservation-started` and `reservation-finished` events by paging
 * Dotypos for Workspace-booked reservations active during a window. It
 * writes only `customer_events` and the `customer_event_sweeps` cursor; a
 * visit's times live only in Dotypos and in each event's `occurred_at`.
 */
export class ReservationActivitySweep extends Context.Service<
  ReservationActivitySweep,
  IReservationActivitySweep
>()("@deskohub-workspace/reservation/ReservationActivitySweep") {
  static Default = Layer.succeed(this, {
    duePages: Effect.fn("ReservationActivitySweep.duePages")(function* (
      at: Temporal.Instant
    ) {
      const { db } = yield* WorkspaceTransaction;
      const cursors = yield* db.select().from(customerEventSweeps);
      const pages = yield* Effect.forEach(cursors, (cursor) =>
        cursor.windowStartsAt && cursor.windowEndsAt && cursor.nextPage
          ? Effect.succeed(
              Option.some<ReservationActivityPage>({
                source: cursor.source,
                window: {
                  startsAt: cursor.windowStartsAt,
                  endsAt: cursor.windowEndsAt,
                },
                page: cursor.nextPage,
              })
            )
          : Option.match(
              dueReservationActivityWindow(
                cursor.source,
                cursor.sweptUntil,
                at
              ),
              {
                onNone: () => Effect.succeedNone,
                onSome: (window) =>
                  openWindow({
                    source: cursor.source,
                    sweptUntil: cursor.sweptUntil,
                    window,
                    at,
                  }),
              }
            )
      );
      return pages.flatMap(Option.toArray);
    }),
    fetchPage: Effect.fn("ReservationActivitySweep.fetchPage")(function* (
      page: ReservationActivityPage
    ) {
      const visits = yield* ReservationVisits;
      const fetched = yield* visits.activeDuring(page.window, page.page);
      return {
        visits: fetched.visits,
        hasNextPage: Option.isSome(fetched.nextPage),
      } satisfies ReservationActivityFetch;
    }),
    commitPage: Effect.fn("ReservationActivitySweep.commitPage")(function* (
      page: ReservationActivityPage,
      fetched: ReservationActivityFetch,
      at: Temporal.Instant
    ) {
      const { db } = yield* WorkspaceTransaction;
      yield* Effect.forEach(
        visitEvents(fetched.visits, at),
        (event) => recordCustomerEvent({ ...event, recordedAt: at }),
        { discard: true }
      );

      const next = nextCursor(page, fetched, at);
      const advanced = yield* db
        .update(customerEventSweeps)
        .set({ ...next.cursor, updatedAt: at })
        .where(
          and(
            eq(customerEventSweeps.source, page.source),
            eq(customerEventSweeps.windowStartsAt, page.window.startsAt),
            eq(customerEventSweeps.windowEndsAt, page.window.endsAt),
            eq(customerEventSweeps.nextPage, page.page)
          )
        )
        .returning({ source: customerEventSweeps.source });

      return advanced.length > 0 ? next.page : Option.none();
    }),
  });
}

/** Opens `window` by CAS, so overlapping planners open it once. */
const openWindow = ({
  source,
  sweptUntil,
  window,
  at,
}: {
  readonly source: ReservationActivityPage["source"];
  readonly sweptUntil: Temporal.Instant;
  readonly window: ReservationActivityWindow;
  readonly at: Temporal.Instant;
}) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .update(customerEventSweeps)
      .set({
        windowStartsAt: window.startsAt,
        windowEndsAt: window.endsAt,
        nextPage: 1,
        updatedAt: at,
      })
      .where(
        and(
          eq(customerEventSweeps.source, source),
          eq(customerEventSweeps.sweptUntil, sweptUntil),
          isNull(customerEventSweeps.windowStartsAt)
        )
      )
      .returning({ source: customerEventSweeps.source })
      .pipe(
        Effect.map((opened) =>
          opened.length > 0
            ? Option.some<ReservationActivityPage>({ source, window, page: 1 })
            : Option.none()
        )
      )
  );

/**
 * A visit has started once its start is past and finished once its end is
 * past. Each event is unique per visit time, so a re-swept visit is a no-op
 * and a visit Dotypos moved records a new event at its new time.
 */
const visitEvents = (
  visits: ReadonlyArray<ReservationVisit>,
  at: Temporal.Instant
): ReadonlyArray<NewCustomerEvent> =>
  visits
    .filter((visit) => visit.status === "active")
    .flatMap((visit) => [
      ...(Temporal.Instant.compare(visit.startsAt, at) <= 0
        ? [visitEvent("reservation-started", visit, visit.startsAt)]
        : []),
      ...(Temporal.Instant.compare(visit.endsAt, at) <= 0
        ? [visitEvent("reservation-finished", visit, visit.endsAt)]
        : []),
    ]);

const visitEvent = (
  kind: "reservation-started" | "reservation-finished",
  visit: ReservationVisit,
  occurredAt: Temporal.Instant
): NewCustomerEvent => ({
  kind,
  occurredAt,
  dotyposCustomerId: visit.dotyposCustomerId,
  workspaceReservationId: visit.workspaceReservationId,
});

/**
 * The cursor after `page`: the next page of the same window, or, after the
 * window's last page, `sweptUntil` at the window end and the chained window,
 * if the sweep still lags.
 */
const nextCursor = (
  page: ReservationActivityPage,
  fetched: ReservationActivityFetch,
  at: Temporal.Instant
) => {
  if (fetched.hasNextPage) {
    return {
      cursor: { nextPage: page.page + 1 },
      page: Option.some<ReservationActivityPage>({
        ...page,
        page: page.page + 1,
      }),
    };
  }

  const chained = chainedReservationActivityWindow(
    page.source,
    page.window,
    at
  );
  return {
    cursor: {
      sweptUntil: page.window.endsAt,
      windowStartsAt: Option.getOrNull(Option.map(chained, (w) => w.startsAt)),
      windowEndsAt: Option.getOrNull(Option.map(chained, (w) => w.endsAt)),
      nextPage: Option.isSome(chained) ? 1 : null,
    },
    page: Option.map(
      chained,
      (window): ReservationActivityPage => ({
        source: page.source,
        window,
        page: 1,
      })
    ),
  };
};
