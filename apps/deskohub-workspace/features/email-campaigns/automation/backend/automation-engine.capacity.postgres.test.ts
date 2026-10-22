import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
  ExternalAPIError,
} from "@deskohub/dotypos";
import type {
  AudienceFilter,
  AutomationFlow,
  CalendarExpression,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option, References } from "effect";
import { TestClock } from "effect/testing";
import {
  createWorkspacePostgresSuiteDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { nextStartWithinHorizon } from "@/shared/utils/calendar-expression";
import {
  everyoneFilter,
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  type AutomationEngineScenario,
  type AutomationScenarioPlanningStep,
  type AutomationScenarioServices,
  databaseInstant,
  engineProfile,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import {
  type AutomationEngineSimulation,
  makeAutomationEngineSimulation,
} from "./automation-engine-simulation.test-utils";
import {
  automationFlowFixture,
  bookedSendFlow,
} from "./automation-lifecycle.test-utils";
import { scheduleDedupKey } from "./automation-schedule-fires";

/**
 * The engine plans every active automation over every active consent, so
 * the suite runs on a database of its own: another suite's automations
 * would share its slots and their customers its pools.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_capacity"
);

/**
 * Real Postgres under simulated hours: well past the package's 30 s
 * default. The 60-fire drain commits about 2,900 chunk units.
 */
const scenarioTimeout = { timeout: 120_000 };
const drainTimeout = { timeout: 420_000 };

/** Tuesday 20 October 2026, 09:00 Prague (CEST). */
const start = Temporal.Instant.from("2026-10-20T07:00:00Z");

/**
 * Every minute: save validation now rejects it (D36). The scenarios that
 * use it cover the engine staying bounded under such a stored schedule,
 * seeded by `seedActiveWithPreTickSchedule`.
 */
const everyMinute: CalendarExpression = {
  minutes: Array.from({ length: 60 }, (_, minute) => minute),
};
/** 09:00 Prague: one fire on the engine's first tick. */
const dailyAtNine: CalendarExpression = { minutes: [0], hours: [9] };

/**
 * Schedule → wait 30 days → send. Entered runs park at the wait, so fires
 * compete with nothing but each other unless a test adds work.
 */
const scheduleFlow = (calendar: CalendarExpression): AutomationFlow =>
  automationFlowFixture({
    trigger: { _tag: "Schedule", calendar },
    steps: [
      {
        _tag: "Wait",
        id: "later",
        wait: { _tag: "Duration", count: 30, unit: "day" },
      },
      { _tag: "Send", id: "send" },
    ],
  });

const scheduleSendFlow = (calendar: CalendarExpression): AutomationFlow =>
  automationFlowFixture({
    trigger: { _tag: "Schedule", calendar },
    steps: [{ _tag: "Send", id: "send" }],
  });

/**
 * Activates `scheduleFlow(calendar)` at `at` as it stands when it was saved
 * before schedules were held to the engine's tick minutes (D36): its
 * campaign, version and automation rows are written directly, past the save
 * validation that now rejects `calendar`.
 */
const seedActiveWithPreTickSchedule = async (
  scenario: AutomationEngineScenario,
  calendar: CalendarExpression,
  input: {
    readonly audienceFilter: AudienceFilter;
    readonly at: Temporal.Instant;
  }
) => {
  const { db } = database!;
  const flow = scheduleFlow(calendar);
  const campaignId = await seedAutomatedCampaign(db, { purpose: "marketing" });
  scenario.kit.campaignIds.push(campaignId);
  const versionId = await seedAutomationVersion(db, {
    campaignId,
    purpose: "marketing",
    flow,
    audienceFilter: input.audienceFilter,
    activatedAt: input.at,
  });
  await seedAutomation(db, {
    campaignId,
    activeVersionId: versionId,
    flow,
    acceptingSince: input.at,
    nextFireAt: Option.getOrNull(nextStartWithinHorizon(calendar, input.at)),
  });
  return { campaignId, versionId };
};

/**
 * Everyone who visited within a year: the audience reads visits, so a chunk
 * of 50 customers with r bookings each costs 1 + r requests (§5.12).
 */
const visitedThisYear: AudienceFilter = {
  _tag: "Condition",
  attribute: "lastVisit",
  operator: "in",
  value: { _tag: "Last", count: 1, unit: "year" },
};

const rateLimited = new ExternalAPIError({
  service: "Dotypos",
  operation: "listReservationsPage",
  statusCode: 429,
  message: "rate limited",
});

/** Within `tolerance` (default 5 %) of the model's figure. */
const expectNearModel = (measured: number, model: number, tolerance = 0.05) => {
  expect(Math.abs(measured - model) / model).toBeLessThanOrEqual(tolerance);
};

const secondsBetween = (earlier: Temporal.Instant, later: Temporal.Instant) =>
  later.since(earlier).total("seconds");

type FireRow = {
  readonly fire_at: string;
  readonly created_at: string;
  readonly settled_at: string | null;
  readonly status: string;
  readonly chunks_total: number;
};

/** A fire's T: from its creation to its last chunk's commit. */
const fireSeconds = (fire: FireRow) =>
  secondsBetween(
    databaseInstant(fire.created_at)!,
    databaseInstant(fire.settled_at)!
  );

describe.skipIf(!database)("engine capacity (§5.12) on Postgres", () => {
  if (!database) return;
  const { pool } = database;
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  afterAll(() => database.close());

  /**
   * The full engine with the given slot limits and planner steps, the
   * discrete-event driver over it, and every Dotypos request held for the
   * driver's latency L, failing where `failWhen` says so.
   */
  const capacityEngine = async (input: {
    readonly latency: number;
    readonly overhead: number;
    readonly limits?: { readonly total: number; readonly deliver: number };
    readonly planning?: ReadonlyArray<AutomationScenarioPlanningStep>;
    readonly sweptUntil?: Temporal.Instant;
  }) => {
    const scenario = await makeAutomationEngineScenario({
      database,
      now: start,
      ...(input.limits && { limits: input.limits }),
      ...(input.planning && { planning: input.planning }),
    });
    cleanups.push(scenario.cleanup);
    await scenario.prepare(input.sweptUntil ?? start);
    const simulation = makeAutomationEngineSimulation({
      queue: scenario.queue,
      start,
      latency: { seconds: input.latency },
      overhead: { seconds: input.overhead },
    });
    let failRequest:
      | ((request: {
          readonly unitId: AutomationWorkUnitId;
          readonly request: number;
        }) => boolean)
      | undefined;
    scenario.dotypos.onRequest(() =>
      simulation.dotyposRequest.pipe(
        Effect.flatMap((request) =>
          request !== undefined && failRequest?.(request)
            ? Effect.fail(rateLimited)
            : Effect.void
        )
      )
    );
    return {
      scenario,
      simulation,
      failWhen: (next: typeof failRequest) => {
        failRequest = next;
      },
      ...bulkPool(scenario),
    };
  };

  /**
   * Synthetic customers with active consents and Workspace-booked visits a
   * month back, seeded in bulk in SQL; their Dotypos facts stay in the fake.
   */
  const bulkPool = (scenario: AutomationEngineScenario) => {
    const prefix = `capacity-${crypto.randomUUID().slice(0, 8)}`;
    cleanups.push(async () => {
      await pool.query(
        "delete from workspace_reservations where id like $1 || '-%'",
        [prefix]
      );
      await pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id like $1 || '-%'",
        [prefix]
      );
    });
    const visitedAt = start.subtract({ hours: 24 * 30 });
    const seeded: DotyposCustomerId[] = [];

    const seedCustomers = async (input: {
      readonly count: number;
      readonly bookings: (index: number) => number;
    }) => {
      const ids: DotyposCustomerId[] = [];
      const reservationIds: string[] = [];
      const reservationCustomers: DotyposCustomerId[] = [];
      for (let index = 0; index < input.count; index++) {
        const id = DotyposCustomerIdSchema.make(
          `${prefix}-${String(seeded.length + index).padStart(5, "0")}`
        );
        ids.push(id);
        scenario.dotypos.customers.set(id, engineProfile(id));
        for (let booking = 0; booking < input.bookings(index); booking++) {
          const reservationId = `${id}-r${booking}`;
          reservationIds.push(reservationId);
          reservationCustomers.push(id);
          const dotyposId = DotyposReservationIdSchema.make(
            `${reservationId}-dotypos`
          );
          scenario.dotypos.reservations.set(dotyposId, {
            id: dotyposId,
            _branchId: "capacity-branch",
            _cloudId: "capacity-cloud",
            _customerId: id,
            startDate: visitedAt.toString(),
            endDate: visitedAt.add({ hours: 2 }).toString(),
            seats: "1",
            status: "CONFIRMED",
          } as DotyposReservation);
        }
      }
      seeded.push(...ids);
      await pool.query(
        `insert into customer_marketing_consents
           (dotypos_customer_id, document_hash, locale, granted_at)
         select id, 'hash', 'cs-CZ', '2026-01-01T00:00:00Z' from unnest($1::text[]) id`,
        [ids]
      );
      const confirmedAt = visitedAt.subtract({ hours: 48 }).toString();
      await pool.query(
        `insert into workspace_reservations
           (id, checkout_attempt_key, dotypos_customer_id, author_account_id,
            dotypos_reservation_id, reservation_state, reservation_confirmed_at,
            payment_state, paid_at, fulfillment_state, fulfilled_at,
            reservation_details, locale, reservation_created_at)
         select r.id, r.id, r.customer, $4, r.id || '-dotypos',
                'confirmed', $3, 'paid', $3, 'fulfilled', $3,
                '{"kind":"cowork","entryTier":"open-space","coffee":false}'::jsonb,
                'cs-CZ', $3
         from unnest($1::text[], $2::text[]) as r(id, customer)`,
        [
          reservationIds,
          reservationCustomers,
          confirmedAt,
          fixtureReservationAuthorId,
        ]
      );
      return ids;
    };

    /** A `reservation-booked` event at `at` for each customer's first booking. */
    const recordBookings = (
      customers: readonly DotyposCustomerId[],
      at: Temporal.Instant
    ) =>
      pool.query(
        `insert into customer_events
           (kind, occurred_at, recorded_at, dotypos_customer_id, workspace_reservation_id)
         select 'reservation-booked', $2, $2, c, c || '-r0' from unnest($1::text[]) c`,
        [customers, at.toString()]
      );

    return { seedCustomers, recordBookings };
  };

  /** Runs one simulated program on the scenario's engine and one `TestClock`. */
  const simulate = <A, E>(
    scenario: AutomationEngineScenario,
    program: Effect.Effect<A, E, AutomationScenarioServices>
  ) =>
    Effect.runPromise(
      program.pipe(
        // Thousands of units: keep the per-query info logs out of the run.
        Effect.provideService(References.MinimumLogLevel, "Warn"),
        Effect.provide(Layer.merge(scenario.layer, TestClock.layer()))
      )
    );

  const query = <Row extends object>(text: string, values: unknown[] = []) =>
    Effect.promise(() => pool.query<Row>(text, values)).pipe(
      Effect.map(({ rows }) => rows)
    );

  const readFires = async (campaignId: CampaignId) =>
    (
      await pool.query<FireRow>(
        "select * from email_campaign_automation_schedule_fires where campaign_id = $1 order by fire_at",
        [campaignId]
      )
    ).rows;

  const readUnits = async (kind: string) =>
    (
      await pool.query<{
        id: AutomationWorkUnitId;
        campaign_id: CampaignId | null;
        subject: {
          customerIds?: string[];
          page?: number;
          source?: string;
          windowEndsAt?: string;
        };
        request_cost: number;
        status: string;
        attempts: number;
        deadline_misses: number;
        last_error_code: string | null;
      }>(
        "select * from email_campaign_automation_work_units where kind = $1 order by created_at, id",
        [kind]
      )
    ).rows;

  const readReceipts = async (campaignId: CampaignId) =>
    (
      await pool.query<{
        dedup_key: string;
        dotypos_customer_id: DotyposCustomerId;
        disposition: string;
        run_id: string | null;
      }>(
        "select * from email_campaign_automation_trigger_receipts where campaign_id = $1",
        [campaignId]
      )
    ).rows;

  const readRuns = async (campaignId: CampaignId) =>
    (
      await pool.query<{
        dotypos_customer_id: DotyposCustomerId;
        trigger_at: string;
        status: string;
        outcome: string | null;
        ended_at: string | null;
      }>(
        "select * from email_campaign_automation_runs where campaign_id = $1",
        [campaignId]
      )
    ).rows;

  const firesEntered = (campaignId: CampaignId, count: number) =>
    query<{ entered: number }>(
      "select count(*)::int as entered from email_campaign_automation_schedule_fires where campaign_id = $1 and status = 'entered'",
      [campaignId]
    ).pipe(Effect.map(([row]) => row!.entered >= count));

  /** Claimed units right now, in total and of the deliver kind. */
  const claimedUnits = query<{ claimed: number; deliver: number }>(
    `select count(*)::int as claimed,
            (count(*) filter (where kind = 'deliver'))::int as deliver
     from email_campaign_automation_work_units where status = 'claimed'`
  ).pipe(Effect.map(([row]) => row!));

  /** The most units, and deliver units, claimed at once; `track` samples after an event. */
  const claimedPeak = () => {
    const peak = { claimed: 0, deliver: 0 };
    const track = claimedUnits.pipe(
      Effect.flatMap((now) =>
        Effect.sync(() => {
          peak.claimed = Math.max(peak.claimed, now.claimed);
          peak.deliver = Math.max(peak.deliver, now.deliver);
        })
      )
    );
    return { peak, track };
  };

  const deliveriesOf = (
    simulation: AutomationEngineSimulation,
    unitId: AutomationWorkUnitId
  ) => simulation.deliveries().filter((delivery) => delivery.unitId === unitId);

  describe("at K = 1", () => {
    test(
      "a 30-page sweep window completes without refetching a page",
      scenarioTimeout,
      async () => {
        const { scenario, simulation } = await capacityEngine({
          latency: 2,
          overhead: 1,
          limits: { total: 1, deliver: 1 },
          planning: ["sweep"],
          sweptUntil: start.subtract({ minutes: 1 }),
        });
        // 3,000 visits active through the window: 30 pages of 100.
        for (let index = 0; index < 3000; index++) {
          const id = DotyposReservationIdSchema.make(`capacity-sweep-${index}`);
          scenario.dotypos.reservations.set(id, {
            id,
            _branchId: "capacity-branch",
            _cloudId: "capacity-cloud",
            _customerId: `capacity-sweep-customer-${index}`,
            startDate: start.subtract({ hours: 1 }).toString(),
            endDate: start.add({ hours: 1 }).toString(),
            seats: "1",
            status: "CONFIRMED",
          } as DotyposReservation);
        }
        const sweptUntil = () =>
          query<{ swept_until: string }>(
            "select swept_until from customer_event_sweeps where source = 'reservation-activity'"
          ).pipe(Effect.map(([row]) => databaseInstant(row!.swept_until)!));
        const claimed = claimedPeak();

        await simulate(
          scenario,
          simulation.run({
            until: start.add({ minutes: 10 }),
            stopWhen: sweptUntil().pipe(
              Effect.map(
                (instant) => Temporal.Instant.compare(instant, start) >= 0
              )
            ),
            afterEvent: claimed.track,
          })
        );

        // The window (08:57, 09:00]; its last page plans the next window at once.
        const window = (await readUnits("sweep-page")).filter(
          (unit) =>
            unit.subject.source === "reservation-activity" &&
            unit.subject.windowEndsAt !== undefined &&
            Temporal.Instant.from(unit.subject.windowEndsAt).equals(start)
        );
        expect(window.map((unit) => unit.subject.page)).toEqual(
          Array.from({ length: 30 }, (_, page) => page + 1)
        );
        expect(window.every((unit) => unit.status === "done")).toBe(true);
        // Every page unit, the hourly reconcile's included, fetched once.
        const pages = (await readUnits("sweep-page")).filter(
          (unit) => unit.status === "done"
        );
        expect(pages.every((unit) => unit.attempts === 1)).toBe(true);
        expect(scenario.dotypos.calls.listActiveReservationsPage).toBe(
          pages.length
        );
        expect(claimed.peak.claimed).toBe(1);
      }
    );

    test(
      "a 1,000-customer fire and an intake burst both finish",
      scenarioTimeout,
      async () => {
        const { scenario, simulation, seedCustomers, recordBookings } =
          await capacityEngine({
            latency: 2,
            overhead: 1,
            limits: { total: 1, deliver: 1 },
            planning: ["intake", "schedules"],
          });
        const customers = await seedCustomers({
          count: 1000,
          bookings: () => 2,
        });
        const schedule = await scenario.kit.seedActive(
          scheduleFlow(dailyAtNine),
          {
            audienceFilter: visitedThisYear,
            at: start.subtract({ hours: 1 }),
          }
        );
        const booked = await scenario.kit.seedActive(bookedSendFlow, {
          audienceFilter: everyoneFilter,
          at: start.subtract({ hours: 1 }),
        });
        const burst = customers.slice(0, 200);
        await recordBookings(burst, start.subtract({ seconds: 30 }));
        const claimed = claimedPeak();

        await simulate(
          scenario,
          simulation.run({
            until: start.add({ minutes: 30 }),
            stopWhen: Effect.all([
              firesEntered(schedule.campaignId, 1),
              query<{ open: number }>(
                "select count(*)::int as open from customer_events where dotypos_customer_id = any($1) and automation_processed_at is null",
                [burst]
              ),
            ]).pipe(
              Effect.map(([entered, [row]]) => entered && row!.open === 0)
            ),
            afterEvent: claimed.track,
          })
        );

        const [fire] = await readFires(schedule.campaignId);
        expect(fire).toMatchObject({ status: "entered", chunks_total: 20 });
        expect(await readRuns(schedule.campaignId)).toHaveLength(1000);
        expect(await readRuns(booked.campaignId)).toHaveLength(200);
        expect(claimed.peak.claimed).toBe(1);
        // Intake (priority 2) ran before every fire chunk (priority 6).
        const intakeUnits = new Set(
          (await readUnits("intake")).map(({ id }) => id)
        );
        const chunkUnits = new Set(
          (await readUnits("fire-chunk")).map(({ id }) => id)
        );
        const deliveries = simulation.deliveries();
        const intakeDone = Math.max(
          ...deliveries
            .filter((delivery) => intakeUnits.has(delivery.unitId))
            .map((delivery) => delivery.settledAt!.epochMilliseconds)
        );
        const firstChunk = Math.min(
          ...deliveries
            .filter((delivery) => chunkUnits.has(delivery.unitId))
            .map((delivery) => delivery.deliveredAt.epochMilliseconds)
        );
        expect(intakeUnits.size).toBeGreaterThan(0);
        expect(intakeDone).toBeLessThanOrEqual(firstChunk);
      }
    );

    test(
      "a 3-fire replay enters in order with trigger_at = F",
      scenarioTimeout,
      async () => {
        const { scenario, simulation, seedCustomers } = await capacityEngine({
          latency: 2,
          overhead: 1,
          limits: { total: 1, deliver: 1 },
          planning: ["schedules"],
        });
        const customers = await seedCustomers({
          count: 120,
          bookings: () => 1,
        });
        // Activated just after 08:57: the 08:58, 08:59 and 09:00 fires are due.
        const { campaignId } = await seedActiveWithPreTickSchedule(
          scenario,
          everyMinute,
          {
            audienceFilter: visitedThisYear,
            at: start.subtract({ minutes: 3 }).add({ seconds: 1 }),
          }
        );

        await simulate(
          scenario,
          simulation.run({
            until: start.add({ minutes: 5 }),
            stopWhen: firesEntered(campaignId, 3),
          })
        );

        const replayed = (await readFires(campaignId)).slice(0, 3);
        const fireAts = [2, 1, 0].map((minutes) => start.subtract({ minutes }));
        expect(replayed.map((fire) => databaseInstant(fire.fire_at))).toEqual(
          fireAts
        );
        expect(replayed.every((fire) => fire.status === "entered")).toBe(true);
        // One at a time, in order: each fire is created once its predecessor entered.
        for (let index = 1; index < replayed.length; index++) {
          expect(
            Temporal.Instant.compare(
              databaseInstant(replayed[index]!.created_at)!,
              databaseInstant(replayed[index - 1]!.settled_at)!
            )
          ).toBeGreaterThanOrEqual(0);
        }
        const runs = await readRuns(campaignId);
        expect(runs).toHaveLength(120);
        expect(
          runs.every((run) =>
            databaseInstant(run.trigger_at)!.equals(fireAts[0]!)
          )
        ).toBe(true);
        const receipts = new Map(
          (await readReceipts(campaignId)).map((receipt) => [
            receipt.dedup_key,
            receipt.disposition,
          ])
        );
        for (const [index, fireAt] of fireAts.entries()) {
          for (const customer of customers) {
            expect(receipts.get(scheduleDedupKey(fireAt, customer))).toBe(
              index === 0 ? "started" : "already-active"
            );
          }
        }
      }
    );
  });

  test(
    "never more than K claimed units or two deliver units; packed units stay ≤ 8 requests and commit within 270 s at L = 30 s",
    scenarioTimeout,
    async () => {
      const { scenario, simulation, seedCustomers } = await capacityEngine({
        latency: 30,
        overhead: 5,
      });
      // In id order: a 400-booking customer, a 300-booking one, then 298 with two.
      const customers = await seedCustomers({
        count: 300,
        bookings: (index) => [400, 300][index] ?? 2,
      });
      const visits = await scenario.kit.seedActive(scheduleFlow(dailyAtNine), {
        audienceFilter: visitedThisYear,
        at: start.subtract({ hours: 1 }),
      });
      const sends = await scenario.kit.seedActive(
        scheduleSendFlow(dailyAtNine),
        {
          audienceFilter: everyoneFilter,
          at: start.subtract({ hours: 1 }),
        }
      );
      const claimed = claimedPeak();

      await simulate(
        scenario,
        simulation.run({
          until: start.add({ hours: 1 }),
          stopWhen: Effect.all([
            firesEntered(visits.campaignId, 1),
            query<{ open: number }>(
              "select count(*)::int as open from email_campaign_automation_runs where campaign_id = $1 and status <> 'ended'",
              [sends.campaignId]
            ),
            firesEntered(sends.campaignId, 1),
          ]).pipe(
            Effect.map(
              ([visitsEntered, [open], sendsEntered]) =>
                visitsEntered && sendsEntered && open!.open === 0
            )
          ),
          afterEvent: claimed.track,
        })
      );

      expect(claimed.peak.claimed).toBe(4);
      expect(claimed.peak.deliver).toBeLessThanOrEqual(2);
      expect(claimed.peak.deliver).toBe(1);

      const chunks = await readUnits("fire-chunk");
      const solo = chunks.find(
        (unit) => unit.subject.customerIds?.[0] === customers[0]
      )!;
      // The 400-booking customer: 1 + ⌈400/50⌉ = 9 requests, alone.
      expect(solo).toMatchObject({ request_cost: 9 });
      expect(solo.subject.customerIds).toEqual([customers[0]]);
      // The 300-booking one shares a chunk: 300 + 25 × 2 = 350 bookings, 8 requests.
      const shared = chunks.find((unit) =>
        unit.subject.customerIds?.includes(customers[1]!)
      )!;
      expect(shared.request_cost).toBe(8);
      expect(shared.subject.customerIds).toHaveLength(26);

      const packed = new Set(
        [...chunks, ...(await readUnits("deliver"))]
          .filter((unit) => unit.request_cost <= 8)
          .map((unit) => unit.id)
      );
      const packedDeliveries = simulation
        .deliveries()
        .filter((delivery) => packed.has(delivery.unitId));
      expect(packedDeliveries.length).toBeGreaterThan(0);
      for (const delivery of packedDeliveries) {
        expect(delivery.outcome).toBe("done");
        expect(delivery.requests).toBeLessThanOrEqual(8);
        // At most 8 × 30 s: inside the 270 s deadline.
        expect(
          secondsBetween(delivery.deliveredAt, delivery.settledAt!)
        ).toBeLessThanOrEqual(270);
      }

      // The solo unit needs 9 × 30 s = 270 s, the whole deadline, so it misses
      // it three times; then its customer counts as unavailable and the fire
      // still enters (§5.3).
      expect(
        deliveriesOf(simulation, solo.id).map((delivery) => delivery.outcome)
      ).toEqual(["redelivered", "redelivered", "redelivered", "done"]);
      expect(
        (await readUnits("fire-chunk")).find(({ id }) => id === solo.id)
      ).toMatchObject({ deadline_misses: 3, status: "done" });
      const receipts = await readReceipts(visits.campaignId);
      expect(
        receipts.find((receipt) => receipt.dotypos_customer_id === customers[0])
          ?.disposition
      ).toBe("failed");
      expect(
        (await readRuns(sends.campaignId)).every(
          (run) => run.outcome === "sent"
        )
      ).toBe(true);
    }
  );

  describe("failures hold their slot", () => {
    test(
      "a 429 mid-chunk redelivers after 60 s holding its slot, with no duplicate receipt",
      scenarioTimeout,
      async () => {
        const { scenario, simulation, seedCustomers, failWhen } =
          await capacityEngine({
            latency: 2,
            overhead: 1,
            limits: { total: 1, deliver: 1 },
            planning: ["schedules"],
          });
        const customers = await seedCustomers({
          count: 100,
          bookings: () => 2,
        });
        const { campaignId } = await scenario.kit.seedActive(
          scheduleFlow(dailyAtNine),
          { audienceFilter: visitedThisYear, at: start.subtract({ hours: 1 }) }
        );
        let failed = false;
        // The first chunk's second request (its first visit page) is rate limited once.
        failWhen(({ request }) => {
          if (failed || request !== 2) return false;
          failed = true;
          return true;
        });

        await simulate(
          scenario,
          simulation.run({
            until: start.add({ minutes: 10 }),
            stopWhen: firesEntered(campaignId, 1),
          })
        );

        const [first, second] = await readUnits("fire-chunk");
        const firstDeliveries = deliveriesOf(simulation, first!.id);
        expect(firstDeliveries.map((delivery) => delivery.outcome)).toEqual([
          "redelivered",
          "done",
        ]);
        expect(
          secondsBetween(
            firstDeliveries[0]!.settledAt!,
            firstDeliveries[1]!.deliveredAt
          )
        ).toBe(60);
        expect(first).toMatchObject({ attempts: 2, status: "done" });
        // The slot stayed with the failed unit: the other chunk started only after it settled.
        const [secondDelivery] = deliveriesOf(simulation, second!.id);
        expect(
          Temporal.Instant.compare(
            secondDelivery!.deliveredAt,
            firstDeliveries[1]!.settledAt!
          )
        ).toBeGreaterThanOrEqual(0);
        const receipts = await readReceipts(campaignId);
        expect(receipts).toHaveLength(100);
        expect(
          new Set(receipts.map((receipt) => receipt.dotypos_customer_id))
        ).toEqual(new Set(customers));
        expect(await readRuns(campaignId)).toHaveLength(100);
      }
    );

    test(
      "a killed consumer's unit is reaped and applied once",
      scenarioTimeout,
      async () => {
        const { scenario, simulation, seedCustomers } = await capacityEngine({
          latency: 2,
          overhead: 1,
          limits: { total: 1, deliver: 1 },
          planning: ["schedules"],
        });
        const customers = await seedCustomers({
          count: 100,
          bookings: () => 2,
        });
        const { campaignId } = await scenario.kit.seedActive(
          scheduleFlow(dailyAtNine),
          { audienceFilter: visitedThisYear, at: start.subtract({ hours: 1 }) }
        );
        simulation.killNextConsumer({ onRequest: 2 });

        await simulate(
          scenario,
          simulation.run({
            until: start.add({ minutes: 20 }),
            stopWhen: firesEntered(campaignId, 1),
          })
        );

        const [first] = await readUnits("fire-chunk");
        const firstDeliveries = deliveriesOf(simulation, first!.id);
        expect(firstDeliveries.map((delivery) => delivery.outcome)).toEqual([
          "killed",
          "done",
        ]);
        // The claim (330 s) expires before the planner's reaper requeues it.
        expect(
          secondsBetween(
            firstDeliveries[0]!.deliveredAt,
            firstDeliveries[1]!.deliveredAt
          )
        ).toBeGreaterThanOrEqual(330);
        expect(first).toMatchObject({
          attempts: 2,
          status: "done",
          last_error_code: "claim-expired",
        });
        const receipts = await readReceipts(campaignId);
        expect(receipts).toHaveLength(100);
        expect(
          new Set(receipts.map((receipt) => receipt.dotypos_customer_id))
        ).toEqual(new Set(customers));
        expect(await readRuns(campaignId)).toHaveLength(100);
      }
    );
  });

  describe("round 5's counterexamples, within 5 % of the model", () => {
    test(
      "every minute over 100 × 2 at L = 30 s takes ≈ 95 s per fire and is flagged falling-behind",
      scenarioTimeout,
      async () => {
        const { scenario, simulation, seedCustomers } = await capacityEngine({
          latency: 30,
          overhead: 5,
          planning: ["schedules"],
        });
        await seedCustomers({ count: 100, bookings: () => 2 });
        const { campaignId } = await seedActiveWithPreTickSchedule(
          scenario,
          everyMinute,
          {
            audienceFilter: visitedThisYear,
            at: start.subtract({ seconds: 30 }),
          }
        );

        const end = await simulate(
          scenario,
          simulation.run({ until: start.add({ minutes: 10 }) })
        );

        // n = 2 chunks of c = 3 run side by side: T = 3 × 30 + 5 = 95 s.
        const entered = (await readFires(campaignId)).filter(
          (fire) => fire.status === "entered"
        );
        expect(entered.length).toBeGreaterThanOrEqual(5);
        for (const fire of entered) expectNearModel(fireSeconds(fire), 95);
        // Lag grows 1 − I/T = 1 − 60/95 ≈ 0.37 min per elapsed minute.
        const lagOf = (fire: FireRow) =>
          secondsBetween(
            databaseInstant(fire.fire_at)!,
            databaseInstant(fire.created_at)!
          );
        const [firstFire, lastFire] = [entered[0]!, entered.at(-1)!];
        expectNearModel(
          (lagOf(lastFire) - lagOf(firstFire)) /
            secondsBetween(
              databaseInstant(firstFire.created_at)!,
              databaseInstant(lastFire.created_at)!
            ),
          1 - 60 / 95
        );
        const health = await scenario.health(end);
        expect(health.warnings).toContain("falling-behind");
        const automation = health.automations.find(
          (entry) => entry.campaignId === campaignId
        );
        expect(automation?.lastFire).toMatchObject({
          fallingBehind: true,
          intervalSeconds: 60,
        });
        expectNearModel(automation!.lastFire!.durationSeconds, 95);
      }
    );

    test(
      "1,800 × 2 at L = 2 s, o = 1 s, S = 4 enters one fire in ≈ 63 s",
      scenarioTimeout,
      async () => {
        const { scenario, simulation, seedCustomers } = await capacityEngine({
          latency: 2,
          overhead: 1,
          planning: ["schedules"],
        });
        await seedCustomers({ count: 1800, bookings: () => 2 });
        const { campaignId } = await scenario.kit.seedActive(
          scheduleFlow(dailyAtNine),
          { audienceFilter: visitedThisYear, at: start.subtract({ hours: 1 }) }
        );

        await simulate(
          scenario,
          simulation.run({
            until: start.add({ minutes: 10 }),
            stopWhen: firesEntered(campaignId, 1),
          })
        );

        // n = 36 chunks of c = 1 + 2; t = c·L + o = 7 s; ⌈36/4⌉ = 9 rounds.
        const [fire] = await readFires(campaignId);
        expect(fire).toMatchObject({ status: "entered", chunks_total: 36 });
        expect(await readRuns(campaignId)).toHaveLength(1800);
        expectNearModel(fireSeconds(fire!), 63);
      }
    );

    test(
      "60 missed 1,000 × 2 fires drain in ≈ 84 min, in order",
      drainTimeout,
      async () => {
        const { scenario, simulation, seedCustomers } = await capacityEngine({
          latency: 2,
          overhead: 1,
          planning: ["schedules"],
        });
        await seedCustomers({ count: 1000, bookings: () => 2 });
        // Activated an hour ago: the 08:01 … 09:00 fires are due at 09:00.
        const { campaignId } = await seedActiveWithPreTickSchedule(
          scenario,
          everyMinute,
          { audienceFilter: visitedThisYear, at: start.subtract({ hours: 1 }) }
        );
        const caughtUp = query<{
          next_fire_at: string | null;
          entering: number;
        }>(
          `select a.next_fire_at,
                (select count(*)::int from email_campaign_automation_schedule_fires f
                  where f.campaign_id = a.campaign_id and f.status = 'entering') as entering
         from email_campaign_automations a where a.campaign_id = $1`,
          [campaignId]
        ).pipe(
          Effect.map(
            ([row]) =>
              row!.entering === 0 &&
              Temporal.Instant.compare(
                databaseInstant(row!.next_fire_at)!,
                simulation.now()
              ) > 0
          )
        );

        const drained = await simulate(
          scenario,
          simulation.run({
            until: start.add({ hours: 3 }),
            stopWhen: caughtUp,
          })
        );

        // T = ⌈20/4⌉ × (3 × 2 + 1) = 35 s against I = 60 s, so B = 60 fires
        // drain in B·T / (1 − T/I) = 60 × 35 / (25/60) = 5,040 s = 84 min.
        // Fires are discrete: the 142nd (09:22) enters at 142 × 35 = 4,970 s,
        // before 09:23 falls due, so the backlog clears at ≈ 82.8 min.
        expectNearModel(secondsBetween(start, drained) / 60, 84);
        const fires = await readFires(campaignId);
        expect(fires.every((fire) => fire.status === "entered")).toBe(true);
        expect(databaseInstant(fires[0]!.fire_at)).toEqual(
          start.subtract({ minutes: 59 })
        );
        for (let index = 1; index < fires.length; index++) {
          expect(
            databaseInstant(fires[index]!.fire_at)!.equals(
              databaseInstant(fires[index - 1]!.fire_at)!.add({ minutes: 1 })
            )
          ).toBe(true);
          expect(
            Temporal.Instant.compare(
              databaseInstant(fires[index]!.created_at)!,
              databaseInstant(fires[index - 1]!.settled_at)!
            )
          ).toBeGreaterThanOrEqual(0);
        }
      }
    );
  });

  test(
    "an every-minute schedule over 1,000 at L = 30 s keeps one entering fire, lets an hourly fire and event runs complete, and grows scheduleLag at 1 − I/T",
    scenarioTimeout,
    async () => {
      const { scenario, simulation, seedCustomers, recordBookings } =
        await capacityEngine({ latency: 30, overhead: 5 });
      const customers = await seedCustomers({ count: 1000, bookings: () => 2 });
      const activatedAt = start.subtract({ seconds: 30 });
      const busy = await seedActiveWithPreTickSchedule(scenario, everyMinute, {
        audienceFilter: visitedThisYear,
        at: activatedAt,
      });
      // 09:15 Prague, hourly.
      const hourly = await scenario.kit.seedActive(
        scheduleFlow({ minutes: [15] }),
        {
          audienceFilter: everyoneFilter,
          at: activatedAt,
        }
      );
      const booked = await scenario.kit.seedActive(bookedSendFlow, {
        audienceFilter: everyoneFilter,
        at: activatedAt,
      });
      const lagSamples: Array<{ readonly at: number; readonly lag: number }> =
        [];
      let maxEntering = 0;
      const enteringFires = query<{ entering: number }>(
        `select coalesce(max(entering), 0)::int as entering from (
         select count(*) as entering from email_campaign_automation_schedule_fires
         where status = 'entering' group by campaign_id) per_automation`
      ).pipe(
        Effect.flatMap(([row]) =>
          Effect.sync(() => {
            maxEntering = Math.max(maxEntering, row!.entering);
          })
        )
      );
      const eventsAt = start.add({ minutes: 10 });

      const end = await simulate(
        scenario,
        Effect.gen(function* () {
          for (let minute = 1; minute <= 45; minute++) {
            const at = start.add({ minutes: minute });
            if (Temporal.Instant.compare(at, eventsAt) === 0) {
              yield* Effect.promise(() =>
                recordBookings(customers.slice(0, 10), eventsAt)
              );
            }
            yield* simulation.run({ until: at, afterEvent: enteringFires });
            const health = yield* Effect.promise(() => scenario.health(at));
            const lag = health.automations.find(
              (entry) => entry.campaignId === busy.campaignId
            )?.scheduleLagSeconds;
            if (lag !== null && lag !== undefined) {
              lagSamples.push({ at: at.epochMilliseconds / 1000, lag });
            }
          }
          return simulation.now();
        })
      );

      expect(maxEntering).toBe(1);
      // Another automation's hourly fire enters while the busy one lags.
      const [hourlyFire] = await readFires(hourly.campaignId);
      expect(hourlyFire).toMatchObject({ status: "entered" });
      // Event runs wait at most a unit for a slot: intake and deliver outrank chunks.
      const eventRuns = await readRuns(booked.campaignId);
      expect(eventRuns).toHaveLength(10);
      expect(eventRuns.every((run) => run.outcome === "sent")).toBe(true);

      // T: the busy automation's entered fires (20 chunks of 3 at 95 s each,
      // ⌈20/S⌉ rounds: 475 s at S = 4, 665 s at S = 3, more while the hourly
      // fire shares the slots).
      const entered = (await readFires(busy.campaignId)).filter(
        (fire) => fire.status === "entered"
      );
      expect(entered.length).toBeGreaterThanOrEqual(3);
      const meanT =
        entered.reduce((total, fire) => total + fireSeconds(fire), 0) /
        entered.length;
      // Least-squares slope of the sampled lag against elapsed time.
      const samples = lagSamples.filter(
        ({ at }) =>
          at >=
          databaseInstant(entered[0]!.settled_at)!.epochMilliseconds / 1000
      );
      const meanAt =
        samples.reduce((total, { at }) => total + at, 0) / samples.length;
      const meanLag =
        samples.reduce((total, { lag }) => total + lag, 0) / samples.length;
      const slope =
        samples.reduce(
          (total, { at, lag }) => total + (at - meanAt) * (lag - meanLag),
          0
        ) / samples.reduce((total, { at }) => total + (at - meanAt) ** 2, 0);
      expectNearModel(slope, 1 - 60 / meanT);
      const health = await scenario.health(end);
      expect(health.warnings).toEqual(
        expect.arrayContaining(["falling-behind", "schedule-lagging"])
      );
    }
  );
});
