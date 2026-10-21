import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
  ExternalAPIError,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { type ReservationState, workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { automationEngineTestLayer } from "@/features/email-campaigns/automation/backend/automation-engine.test-utils";
import { AutomationPlanner } from "@/features/email-campaigns/automation/backend/automation-planner.service";
import { AutomationSweepPlanning } from "@/features/email-campaigns/automation/backend/automation-sweep-planning.service";
import {
  AutomationUnitDefect,
  type RegisteredAutomationUnitHandler,
} from "@/features/email-campaigns/automation/backend/automation-unit-handler";
import {
  drainAutomationUnitQueue,
  makeAutomationUnitQueueFake,
} from "@/features/email-campaigns/automation/backend/automation-unit-queue.test-utils";
import { makeSweepPageHandler } from "@/features/email-campaigns/automation/backend/sweep-page";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import type { CustomerEventSweepSource } from "@/shared/backend/customer-events/customer-event";
import { CustomerEventReconciler } from "@/shared/backend/customer-events/customer-event-reconciler";
import {
  createWorkspacePostgresSuiteDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ReservationActivitySweep } from "./reservation-activity-sweep.service";

/**
 * The sweep reads every cursor and the planner every unit, so the suite runs
 * on a database of its own.
 */
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "reservation_activity_sweep"
);
afterAll(() => testDatabase?.close());

/** How a Workspace reservation stands locally; `none` has no local row. */
type LocalState = "booked" | "unconfirmed" | "cancelled" | "none";

const reservationStates = {
  booked: "confirmed",
  unconfirmed: "held",
  cancelled: "cancelled",
} as const satisfies Record<Exclude<LocalState, "none">, ReservationState>;

/** A Dotypos page read the sweep made. */
type ActivityRequest = {
  readonly window: string;
  readonly page: number;
  readonly failed: boolean;
};

/**
 * A `DotyposService` mock answering active-reservation pages from
 * `reservations` with the overlap filter Dotypos applies, recording every
 * request. Each page in `failOnce` fails its first request with a 503.
 */
const activityDotypos = (pageSize: number) => {
  const reservations: DotyposReservation[] = [];
  const requests: ActivityRequest[] = [];
  const failOnce = new Set<number>();

  const layer = DotyposServiceMock({
    listActiveReservationsPage: (interval, page) =>
      Effect.suspend(() => {
        const window = `${interval.startDate.toISOString()}/${interval.endDate.toISOString()}`;
        const failed = failOnce.delete(page);
        requests.push({ window, page, failed });
        if (failed) {
          return Effect.fail(
            new ExternalAPIError({
              service: "dotypos",
              operation: "listActiveReservationsPage",
              statusCode: 503,
            })
          );
        }
        const active = reservations.filter(
          (reservation) =>
            (reservation.status === "NEW" ||
              reservation.status === "CONFIRMED") &&
            Date.parse(reservation.startDate) < interval.endDate.getTime() &&
            Date.parse(reservation.endDate) > interval.startDate.getTime()
        );
        const start = (page - 1) * pageSize;
        return Effect.succeed({
          reservations: active.slice(start, start + pageSize),
          nextPage:
            start + pageSize < active.length
              ? Option.some(page + 1)
              : Option.none(),
        });
      }),
  });

  return { layer, reservations, requests, failOnce };
};
type ActivityDotypos = ReturnType<typeof activityDotypos>;

describe.skipIf(!testDatabase)(
  "ReservationActivitySweep through the engine at K = 1",
  () => {
    if (!testDatabase) return;
    const runId = crypto.randomUUID();
    const insertedIds: WorkspaceReservationId[] = [];

    const customerId = (label: string) =>
      DotyposCustomerIdSchema.make(`sweep-${label}-${runId}`);
    const workspaceId = (label: string) =>
      workspaceReservationIdSchema.make(`sweep-${label}-${runId}`);
    const dotyposId = (label: string) =>
      DotyposReservationIdSchema.make(`sweep-${label}-${runId}`);

    // Slots count every unit, so each test starts with an empty table.
    beforeEach(async () => {
      await testDatabase.pool.query(
        "delete from email_campaign_automation_work_units"
      );
    });

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from email_campaign_automation_work_units"
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [insertedIds]
      );
    });

    /**
     * Books a visit in Dotypos and, unless `local` is `none`, records the
     * matching Workspace reservation. Returns the Dotypos row, so a test can
     * move the visit.
     */
    const book = async (
      dotypos: ActivityDotypos,
      input: {
        readonly label: string;
        readonly startsAt: Temporal.Instant;
        readonly endsAt: Temporal.Instant;
        readonly local?: LocalState;
        readonly status?: DotyposReservation["status"];
      }
    ) => {
      const reservation: DotyposReservation = {
        id: dotyposId(input.label),
        _branchId: "branch",
        _cloudId: "cloud",
        _customerId: customerId(input.label),
        startDate: input.startsAt.toString(),
        endDate: input.endsAt.toString(),
        seats: "1",
        status: input.status ?? "CONFIRMED",
      };
      dotypos.reservations.push(reservation);
      const local = input.local ?? "booked";
      if (local !== "none") await insertLocal([{ label: input.label, local }]);
      return reservation;
    };

    // Outside the capture reconcile's 35-day lookback from the test clock.
    const defaultConfirmedAt = Temporal.Instant.from("2026-10-01T10:00:00Z");

    const insertLocal = async (
      reservations: ReadonlyArray<{
        readonly label: string;
        readonly local: Exclude<LocalState, "none">;
        readonly confirmedAt?: Temporal.Instant;
      }>
    ) => {
      const rows = reservations.map(
        ({ label, local, confirmedAt = defaultConfirmedAt }) => {
          const id = workspaceId(label);
          insertedIds.push(id);
          return {
            authorAccountId: fixtureReservationAuthorId,
            id,
            checkoutAttemptKey: checkoutAttemptKeySchema.make(id),
            dotyposCustomerId: customerId(label),
            dotyposReservationId: dotyposId(label),
            reservationState: reservationStates[local],
            reservationConfirmedAt:
              local === "unconfirmed" ? null : confirmedAt,
            paymentState: "paid" as const,
            paidAt: confirmedAt,
            fulfillmentState: "fulfilled" as const,
            fulfilledAt: confirmedAt,
            reservationDetails: {
              kind: "cowork" as const,
              entryTier: "open-space" as const,
              coffee: false,
            },
            locale: "cs-CZ" as const,
            updatedAt: confirmedAt,
          };
        }
      );
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values(rows)
      );
    };

    /** Started and finished events of the labelled reservations. */
    const visitEvents = async (labels: ReadonlyArray<string>) => {
      const { rows } = await testDatabase.pool.query<{
        kind: string;
        workspace_reservation_id: string;
        occurred_at: string;
      }>(
        `select kind, workspace_reservation_id, occurred_at from customer_events
          where workspace_reservation_id = any($1)
            and kind in ('reservation-started', 'reservation-finished')
          order by occurred_at, kind`,
        [labels.map(workspaceId)]
      );
      return rows.map((row) => ({
        kind: row.kind,
        reservation: row.workspace_reservation_id,
        occurredAt: storedIso(row.occurred_at),
      }));
    };

    /** A stored `timestamptz` as a millisecond ISO string. */
    const storedIso = (value: string) =>
      new Date(Temporal.Instant.from(value).epochMilliseconds).toISOString();

    const visitEvent = (
      kind: "reservation-started" | "reservation-finished",
      label: string,
      occurredAt: Temporal.Instant
    ) => ({
      kind,
      reservation: workspaceId(label),
      occurredAt: new Date(occurredAt.epochMilliseconds).toISOString(),
    });

    const cursorOf = async (source: CustomerEventSweepSource) => {
      const { rows } = await testDatabase.pool.query<{
        swept_until: string;
        window_starts_at: string | null;
        next_page: number | null;
      }>(
        "select swept_until, window_starts_at, next_page from customer_event_sweeps where source = $1",
        [source]
      );
      const [row] = rows;
      if (!row) throw new Error(`No ${source} cursor`);
      return {
        sweptUntil: storedIso(row.swept_until),
        windowOpen: row.window_starts_at !== null,
        nextPage: row.next_page,
      };
    };

    /**
     * Puts both cursors at the given swept instants with no open window. The
     * reconcile defaults to far in the
     * future, so it stays idle.
     */
    const resetSweeps = async (cursors: {
      readonly activity: Temporal.Instant;
      readonly reconcile?: Temporal.Instant;
    }) => {
      await setCursor("reservation-activity", cursors.activity);
      await setCursor(
        "reservation-activity-reconcile",
        cursors.reconcile ?? Temporal.Instant.from("2100-01-01T00:00:00Z")
      );
    };

    const setCursor = (
      source: CustomerEventSweepSource,
      sweptUntil: Temporal.Instant
    ) =>
      testDatabase.pool.query(
        `update customer_event_sweeps
            set swept_until = $2, window_starts_at = null, window_ends_at = null, next_page = null
          where source = $1`,
        [source, sweptUntil.toString()]
      );

    /**
     * The real planner and processor at K = 1 over `dotypos`, with the queue
     * fake. `tick(at)` runs one planner pass at `at` on the test clock, then
     * delivers queued messages until none is left; a failed delivery is
     * queued again, as the queue redelivers it. A page whose unit `defective`
     * returns true for fails with a defect before it fetches.
     */
    const runEngine = async <A, E>(
      dotypos: ActivityDotypos,
      scenario: (
        tick: (at: Temporal.Instant) => Effect.Effect<void, unknown>
      ) => Effect.Effect<A, E>,
      options: { readonly defective?: (unitKey: string) => boolean } = {}
    ) => {
      const sweepCapabilities = Layer.mergeAll(
        testDatabase.layer,
        dotypos.layer,
        ReservationActivitySweep.Default,
        CustomerEventReconciler.Default.pipe(Layer.provide(testDatabase.layer))
      );
      const sweepPage = await Effect.runPromise(
        makeSweepPageHandler.pipe(Effect.provide(sweepCapabilities))
      );
      const handler: RegisteredAutomationUnitHandler = {
        kind: sweepPage.kind,
        fetch: (unit) =>
          options.defective?.(unit.key)
            ? Effect.fail(new AutomationUnitDefect({ code: "test-defect" }))
            : sweepPage.fetch(unit),
      };
      const queue = makeAutomationUnitQueueFake();
      const engine = automationEngineTestLayer({
        database: testDatabase,
        queue,
        handlers: [handler],
        limits: { total: 1, deliver: 1 },
        sweepPlanning: AutomationSweepPlanning.Default.pipe(
          Layer.provide(sweepCapabilities)
        ),
      });

      const tick = (at: Temporal.Instant) =>
        TestClock.setTime(at.epochMilliseconds).pipe(
          Effect.andThen(Effect.flatMap(AutomationPlanner, (p) => p.plan)),
          Effect.andThen(
            drainAutomationUnitQueue(queue, { maxDeliveries: 2_000 })
          ),
          Effect.asVoid
        );

      return Effect.runPromise(
        scenario(tick).pipe(
          Effect.provide(Layer.merge(engine, TestClock.layer()))
        ) as Effect.Effect<A, E>
      );
    };

    /** Page reads of each window, in request order. */
    const pagesByWindow = (dotypos: ActivityDotypos) =>
      Map.groupBy(dotypos.requests, (request) => request.window);

    const at = (value: string) => Temporal.Instant.from(value);

    test("the migration seeds the clock sweep 35 days back and the reconcile now", async () => {
      const { rows } = await testDatabase.pool.query<{
        source: string;
        lag_days: number;
      }>(
        "select source, extract(epoch from now() - swept_until) / 86400 as lag_days from customer_event_sweeps order by source"
      );
      const lag = new Map(
        rows.map((row) => [row.source, Number(row.lag_days)])
      );
      // Both seeds read the same now(); this needs a freshly migrated database.
      expect(
        (lag.get("reservation-activity") ?? 0) -
          (lag.get("reservation-activity-reconcile") ?? 0)
      ).toBeCloseTo(35, 6);
    });

    test("sweeps the 35-day seed in one catch-up, recording its history", async () => {
      const dotypos = activityDotypos(100);
      const now = Temporal.Now.instant().round({
        smallestUnit: "second",
        roundingMode: "floor",
      });
      // The seed's shape, anchored to this run's clock.
      await resetSweeps({ activity: now.subtract({ hours: 35 * 24 }) });
      const visits = [34, 10, 1].map((daysAgo) => ({
        label: `seed-${daysAgo}`,
        startsAt: now.subtract({ hours: daysAgo * 24 }),
        endsAt: now.subtract({ hours: daysAgo * 24 - 2 }),
      }));
      for (const visit of visits) await book(dotypos, visit);

      await runEngine(dotypos, (tick) => tick(now));

      expect(await visitEvents(visits.map((visit) => visit.label))).toEqual(
        visits.flatMap((visit) => [
          visitEvent("reservation-started", visit.label, visit.startsAt),
          visitEvent("reservation-finished", visit.label, visit.endsAt),
        ])
      );
      expect(await cursorOf("reservation-activity")).toEqual({
        sweptUntil: new Date(now.epochMilliseconds).toISOString(),
        windowOpen: false,
        nextPage: null,
      });
      // 35 days in windows of at most six hours, each one page, none twice.
      const windows = pagesByWindow(dotypos);
      expect(windows.size).toBe(140);
      expect(
        [...windows.values()].every(
          (pages) => pages.length === 1 && pages[0]?.page === 1
        )
      ).toBe(true);
    });

    test("pages a 30-page window once each, resuming a failed page at its saved page", async () => {
      const dotypos = activityDotypos(2);
      const now = at("2027-01-11T09:01:00Z");
      await resetSweeps({ activity: now.subtract({ minutes: 1 }) });
      const labels = Array.from({ length: 60 }, (_, index) => `page-${index}`);
      dotypos.reservations.push(
        ...labels.map(
          (label): DotyposReservation => ({
            id: dotyposId(label),
            _branchId: "branch",
            _cloudId: "cloud",
            _customerId: customerId(label),
            startDate: now.subtract({ hours: 1 }).toString(),
            endDate: now.subtract({ minutes: 2 }).toString(),
            seats: "1",
            status: "CONFIRMED",
          })
        )
      );
      await insertLocal(labels.map((label) => ({ label, local: "booked" })));
      dotypos.failOnce.add(15);

      await runEngine(dotypos, (tick) => tick(now));

      expect(dotypos.requests.map((request) => request.page)).toEqual([
        ...Array.from({ length: 15 }, (_, index) => index + 1),
        ...Array.from({ length: 16 }, (_, index) => index + 15),
      ]);
      expect(
        dotypos.requests.filter((request) => request.failed).map((r) => r.page)
      ).toEqual([15]);
      expect(pagesByWindow(dotypos).size).toBe(1);
      const { rows: failedPage } = await testDatabase.pool.query<{
        attempts: number;
        last_error_code: string | null;
        status: string;
      }>(
        "select attempts, last_error_code, status from email_campaign_automation_work_units where kind = 'sweep-page' and key like '%:15'"
      );
      expect(failedPage).toEqual([
        { attempts: 2, last_error_code: "dotypos-503", status: "done" },
      ]);
      expect(await visitEvents(labels)).toHaveLength(120);
      expect(await cursorOf("reservation-activity")).toEqual({
        sweptUntil: "2027-01-11T09:01:00.000Z",
        windowOpen: false,
        nextPage: null,
      });
    });

    test("replans a failed page after its backoff and resumes the window there", async () => {
      const dotypos = activityDotypos(2);
      const now = at("2027-01-20T09:01:00Z");
      await resetSweeps({ activity: now.subtract({ minutes: 1 }) });
      const visits = [0, 1, 2, 3].map((index) => ({
        label: `replanned-${index}`,
        startsAt: now.subtract({ minutes: 60 - index }),
        endsAt: now.subtract({ seconds: 60 - index * 10 }),
      }));
      for (const visit of visits) await book(dotypos, visit);
      let defective = true;
      const failedPage = () =>
        testDatabase.pool
          .query<{ status: string; failures: number }>(
            "select status, failures from email_campaign_automation_work_units where kind = 'sweep-page' and key like '%:2' order by created_at limit 1"
          )
          .then(({ rows }) => rows[0]);
      const lastSummary = () =>
        testDatabase.pool
          .query<{
            summary: { sweepPagesReplanned: number; failingByKind: object };
          }>(
            "select last_plan_summary as summary from email_campaign_automation_engine"
          )
          .then(({ rows }) => rows[0]?.summary);

      const observed = await runEngine(
        dotypos,
        (tick) => {
          const observe = (minutes: number) =>
            tick(now.add({ seconds: minutes * 60 })).pipe(
              Effect.andThen(
                Effect.promise(async () => ({
                  page: await failedPage(),
                  cursor: await cursorOf("reservation-activity"),
                  summary: await lastSummary(),
                }))
              )
            );
          return Effect.all([
            observe(0),
            // Within the first backoff (1 minute): still failed.
            observe(0.5),
            // Replanned, fails again; the next backoff is 2 minutes.
            observe(1),
            observe(2),
            Effect.sync(() => {
              defective = false;
            }).pipe(Effect.andThen(observe(3))),
          ]);
        },
        { defective: (key) => defective && key.endsWith(":2") }
      );

      const stuck = {
        sweptUntil: "2027-01-20T09:00:00.000Z",
        windowOpen: true,
        nextPage: 2,
      };
      expect(observed.map(({ page }) => page)).toEqual([
        { status: "failed", failures: 1 },
        { status: "failed", failures: 1 },
        { status: "failed", failures: 2 },
        { status: "failed", failures: 2 },
        { status: "done", failures: 2 },
      ]);
      expect(observed.slice(0, 4).map(({ cursor }) => cursor)).toEqual([
        stuck,
        stuck,
        stuck,
        stuck,
      ]);
      expect(
        observed.map(({ summary }) => summary?.sweepPagesReplanned)
      ).toEqual([0, 0, 1, 0, 1]);
      expect(observed[3]?.summary?.failingByKind).toEqual({ "sweep-page": 1 });
      // The window's pages were each fetched once, in order: none skipped.
      const [firstWindow] = pagesByWindow(dotypos).values();
      expect(firstWindow?.map((request) => request.page)).toEqual([1, 2]);
      expect(await visitEvents(visits.map((visit) => visit.label))).toEqual([
        ...visits.map((visit) =>
          visitEvent("reservation-started", visit.label, visit.startsAt)
        ),
        ...visits.map((visit) =>
          visitEvent("reservation-finished", visit.label, visit.endsAt)
        ),
      ]);
      expect(observed[4]?.cursor.sweptUntil).not.toBe(stuck.sweptUntil);
    });

    test("catches up after a six-hour outage by chaining windows", async () => {
      const dotypos = activityDotypos(100);
      const now = at("2027-01-12T15:31:00Z");
      await resetSweeps({ activity: now.subtract({ hours: 6, minutes: 30 }) });
      const visit = {
        label: "outage",
        startsAt: now.subtract({ hours: 4 }),
        endsAt: now.subtract({ hours: 3 }),
      };
      await book(dotypos, visit);

      await runEngine(dotypos, (tick) => tick(now));

      expect([...pagesByWindow(dotypos).keys()]).toEqual([
        "2027-01-12T08:59:00.000Z/2027-01-12T15:01:00.000Z",
        "2027-01-12T14:59:00.000Z/2027-01-12T15:31:00.000Z",
      ]);
      expect(await visitEvents([visit.label])).toEqual([
        visitEvent("reservation-started", visit.label, visit.startsAt),
        visitEvent("reservation-finished", visit.label, visit.endsAt),
      ]);
      expect((await cursorOf("reservation-activity")).sweptUntil).toBe(
        "2027-01-12T15:31:00.000Z"
      );
    });

    test("records a visit seen by overlapping windows once", async () => {
      const dotypos = activityDotypos(100);
      const now = at("2027-01-13T09:03:00Z");
      await resetSweeps({ activity: now.subtract({ minutes: 3 }) });
      const visit = {
        label: "overlap",
        startsAt: now.subtract({ hours: 2 }),
        endsAt: now.subtract({ seconds: 30 }),
      };
      await book(dotypos, visit);

      await runEngine(dotypos, (tick) =>
        tick(now).pipe(Effect.andThen(tick(now.add({ minutes: 1 }))))
      );

      expect(pagesByWindow(dotypos).size).toBe(2);
      expect(await visitEvents([visit.label])).toEqual([
        visitEvent("reservation-started", visit.label, visit.startsAt),
        visitEvent("reservation-finished", visit.label, visit.endsAt),
      ]);
    });

    test("records each event at the sweep's instant, not the database's clock", async () => {
      const dotypos = activityDotypos(100);
      const now = at("2027-01-20T09:03:00Z");
      await resetSweeps({ activity: now.subtract({ minutes: 3 }) });
      const visit = {
        label: "recorded",
        startsAt: now.subtract({ hours: 2 }),
        endsAt: now.subtract({ minutes: 2 }),
      };
      await book(dotypos, visit);

      await runEngine(dotypos, (tick) => tick(now));

      const { rows } = await testDatabase.pool.query<{ recorded_at: string }>(
        "select recorded_at from customer_events where workspace_reservation_id = $1",
        [workspaceId(visit.label)]
      );
      expect(rows.map((row) => storedIso(row.recorded_at))).toEqual([
        "2027-01-20T09:03:00.000Z",
        "2027-01-20T09:03:00.000Z",
      ]);
    });

    test("a 600-hour office visit starts in its first window and finishes after its end", async () => {
      const dotypos = activityDotypos(100);
      const now = at("2027-02-01T08:01:00Z");
      await resetSweeps({ activity: now });
      const visit = {
        label: "office",
        startsAt: now.add({ minutes: 30 }),
        endsAt: now.add({ minutes: 30 }).add({ hours: 600 }),
      };
      await book(dotypos, visit);

      await runEngine(dotypos, (tick) =>
        Effect.gen(function* () {
          yield* tick(now.add({ hours: 1 }));
          expect(
            yield* Effect.promise(() => visitEvents([visit.label]))
          ).toEqual([
            visitEvent("reservation-started", visit.label, visit.startsAt),
          ]);
          yield* tick(now.add({ hours: 300 }));
          expect(
            yield* Effect.promise(() => visitEvents([visit.label]))
          ).toHaveLength(1);
          yield* tick(visit.endsAt.add({ hours: 1 }));
        })
      );

      expect(await visitEvents([visit.label])).toEqual([
        visitEvent("reservation-started", visit.label, visit.startsAt),
        visitEvent("reservation-finished", visit.label, visit.endsAt),
      ]);
      expect(
        [...pagesByWindow(dotypos).values()].every(
          (pages) => pages.length === 1
        )
      ).toBe(true);
    });

    test("an extended visit gets a second finished event at its new end", async () => {
      const dotypos = activityDotypos(100);
      const now = at("2027-02-10T08:01:00Z");
      await resetSweeps({ activity: now });
      const visit = {
        label: "extended",
        startsAt: now.subtract({ hours: 1 }),
        endsAt: now.add({ hours: 1 }),
      };
      const reservation = await book(dotypos, visit);
      const extendedEnd = now.add({ hours: 3 });

      await runEngine(dotypos, (tick) =>
        tick(now.add({ hours: 2 })).pipe(
          Effect.andThen(
            Effect.sync(() => {
              reservation.endDate = extendedEnd.toString();
            })
          ),
          Effect.andThen(tick(now.add({ hours: 4 })))
        )
      );

      expect(await visitEvents([visit.label])).toEqual([
        visitEvent("reservation-started", visit.label, visit.startsAt),
        visitEvent("reservation-finished", visit.label, visit.endsAt),
        visitEvent("reservation-finished", visit.label, extendedEnd),
      ]);
    });

    test("the hourly reconcile records a visit moved into swept time", async () => {
      const dotypos = activityDotypos(100);
      // 10:05 in Prague; the reconcile last ran at the start of this hour.
      const now = at("2027-01-11T09:05:00Z");
      await resetSweeps({
        activity: now.subtract({ minutes: 1 }),
        reconcile: at("2027-01-11T09:00:30Z"),
      });
      const visit = {
        label: "moved",
        startsAt: now.add({ hours: 1 }),
        endsAt: now.add({ hours: 2 }),
      };
      const reservation = await book(dotypos, visit);
      const movedStart = now.subtract({ hours: 5 });
      const movedEnd = now.subtract({ hours: 4 });
      const isReconcileWindow = (request: ActivityRequest) => {
        const [startsAt = "", endsAt = ""] = request.window.split("/");
        return (
          Date.parse(endsAt) - Date.parse(startsAt) === 24 * 60 * 60 * 1000
        );
      };

      await runEngine(dotypos, (tick) =>
        Effect.gen(function* () {
          yield* tick(now);
          reservation.startDate = movedStart.toString();
          reservation.endDate = movedEnd.toString();
          yield* tick(now.add({ minutes: 1 }));
          expect(
            yield* Effect.promise(() => visitEvents([visit.label]))
          ).toEqual([]);
          // 11:00:30 in Prague: the first run of the next hour.
          yield* tick(at("2027-01-11T10:00:30Z"));
          yield* tick(at("2027-01-11T10:01:30Z"));
        })
      );

      expect(await visitEvents([visit.label])).toEqual([
        visitEvent("reservation-started", visit.label, movedStart),
        visitEvent("reservation-finished", visit.label, movedEnd),
      ]);
      expect(
        dotypos.requests.filter(isReconcileWindow).map((r) => r.window)
      ).toEqual(["2027-01-10T10:00:30.000Z/2027-01-11T10:00:30.000Z"]);
      expect(await cursorOf("reservation-activity-reconcile")).toEqual({
        sweptUntil: "2027-01-11T10:00:30.000Z",
        windowOpen: false,
        nextPage: null,
      });
    });

    test("reconciles captured events on every planner run, whatever its minute", async () => {
      const dotypos = activityDotypos(100);
      const now = at("2027-03-05T08:07:00Z");
      await resetSweeps({ activity: now.subtract({ minutes: 1 }) });
      await insertLocal([
        {
          label: "uncaptured",
          local: "booked",
          confirmedAt: now.subtract({ hours: 1 }),
        },
      ]);
      const bookedEvents = () =>
        Effect.promise(() =>
          testDatabase.pool
            .query(
              "select 1 from customer_events where kind = 'reservation-booked' and workspace_reservation_id = $1",
              [workspaceId("uncaptured")]
            )
            .then(({ rows }) => rows.length)
        );

      await runEngine(dotypos, (tick) =>
        Effect.gen(function* () {
          yield* tick(now);
          expect(yield* bookedEvents()).toBe(1);
          yield* tick(now.add({ minutes: 15 }));
          expect(yield* bookedEvents()).toBe(1);
        })
      );
    });

    test("Dotypos-cancelled, unconfirmed and non-Workspace reservations emit nothing", async () => {
      const dotypos = activityDotypos(100);
      const now = at("2027-03-01T08:01:00Z");
      await resetSweeps({ activity: now.subtract({ minutes: 1 }) });
      const times = {
        startsAt: now.subtract({ hours: 2 }),
        endsAt: now.subtract({ minutes: 2 }),
      };
      await book(dotypos, {
        label: "dotypos-cancelled",
        ...times,
        status: "CANCELLED",
      });
      await book(dotypos, {
        label: "unconfirmed",
        ...times,
        local: "unconfirmed",
      });
      await book(dotypos, {
        label: "workspace-cancelled",
        ...times,
        local: "cancelled",
      });
      await book(dotypos, { label: "elsewhere", ...times, local: "none" });
      await book(dotypos, { label: "booked", ...times });

      await runEngine(dotypos, (tick) => tick(now));

      expect(
        await visitEvents([
          "dotypos-cancelled",
          "unconfirmed",
          "workspace-cancelled",
          "booked",
        ])
      ).toEqual([
        visitEvent("reservation-started", "booked", times.startsAt),
        visitEvent("reservation-finished", "booked", times.endsAt),
      ]);
      const { rows } = await testDatabase.pool.query(
        "select 1 from customer_events where dotypos_customer_id = $1",
        [customerId("elsewhere")]
      );
      expect(rows).toEqual([]);
    });
  }
);
