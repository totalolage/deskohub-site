import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import type { AutomationFlow } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import {
  customerEvents,
  emailCampaignAutomationRuns as runs,
  workspaceReservations,
} from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  createWorkspacePostgresSuiteDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationStepId,
  AutomationVersionId,
} from "../automation-identifiers";
import {
  entryEngineLayer,
  makeEngineDotypos,
  makeEngineFixtures,
  runEngineAt,
} from "./automation-engine-scenario.test-utils";
import { AutomationIntakePlanning } from "./automation-intake-planning.service";
import { makeAutomationUnitQueueFake } from "./automation-unit-queue.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_intake_planning"
);
afterAll(() => database?.close());
const now = Temporal.Instant.from("2026-10-19T10:00:00Z");
const prefix = `intake-planning-${crypto.randomUUID()}`;

const flowOf = (trigger: AutomationFlow["trigger"]): AutomationFlow => ({
  trigger,
  steps: [{ _tag: "Send", id: "send" as AutomationStepId }],
});

describe.skipIf(!database)("AutomationIntakePlanning on Postgres", () => {
  if (!database) return;
  const { db, pool } = database;
  const dotypos = makeEngineDotypos();
  const fixtures = makeEngineFixtures(database, dotypos, prefix);
  const campaignIds: CampaignId[] = [];

  // Each test's automations would take the next test's events.
  afterEach(async () => {
    await deleteAutomatedCampaigns(db, campaignIds.splice(0));
  });
  afterAll(() => fixtures.cleanup());

  const automation = async (input: {
    readonly flow: AutomationFlow;
    readonly acceptingSince?: Temporal.Instant;
    readonly activatedAt?: Temporal.Instant;
  }) => {
    const campaignId = await seedAutomatedCampaign(db, {
      purpose: "operational",
    });
    campaignIds.push(campaignId);
    const versionId = await seedAutomationVersion(db, {
      campaignId,
      purpose: "operational",
      flow: input.flow,
      activatedAt: input.activatedAt ?? now.subtract({ hours: 48 }),
    });
    await seedAutomation(db, {
      campaignId,
      activeVersionId: versionId,
      acceptingSince: input.acceptingSince ?? now.subtract({ hours: 48 }),
    });
    return { campaignId, versionId };
  };

  const plan = async () => {
    const layer = await entryEngineLayer({
      database,
      dotypos,
      queue: makeAutomationUnitQueueFake(),
    });
    return runEngineAt(
      Effect.flatMap(AutomationIntakePlanning, (planning) =>
        planning.plan(now)
      ),
      layer,
      now
    );
  };

  const eventState = async (eventId: string) => {
    const { rows } = await pool.query(
      "select automation_unit_id, automation_processed_at from customer_events where id = $1",
      [eventId]
    );
    return {
      planned: rows[0].automation_unit_id !== null,
      processed: rows[0].automation_processed_at !== null,
    };
  };

  test("withdraws the active runs of a cancelled reservation, except those its cancellation started", async () => {
    const { campaignId, versionId } = await automation({
      flow: flowOf({ _tag: "ReservationBooked" }),
    });
    const customer = await fixtures.addCustomer("withdrawal");
    const reservationId = await fixtures.book({
      label: "withdrawal",
      customer,
      startsAt: now.add({ hours: 24 }),
      endsAt: now.add({ hours: 26 }),
    });
    const other = await fixtures.addCustomer("withdrawal-other");
    const insertRun = (
      dotyposCustomerId: typeof customer,
      triggerKind: "reservation-booked" | "reservation-cancelled"
    ) =>
      Effect.runPromise(
        db
          .insert(runs)
          .values({
            campaignId,
            versionId: versionId as AutomationVersionId,
            dotyposCustomerId,
            triggerKind,
            triggerAt: now.subtract({ hours: 1 }),
            triggerReservationId: reservationId,
            status: "active",
            stepId: "send" as AutomationStepId,
            phase: "waiting",
            stepEnteredAt: now.subtract({ hours: 1 }),
            dueAt: now.add({ hours: 1 }),
          })
          .returning({ id: runs.id })
      ).then(([run]) => run!.id);
    const booked = await insertRun(customer, "reservation-booked");
    const byCancellation = await insertRun(other, "reservation-cancelled");
    await fixtures.recordEvent({
      kind: "reservation-cancelled",
      customer,
      reservationId,
      occurredAt: now.subtract({ minutes: 5 }),
    });

    const summary = await plan();

    expect(summary.withdrawnRuns).toBe(1);
    const { rows } = await pool.query(
      "select id, status, outcome from email_campaign_automation_runs where id = any($1) order by id",
      [[booked, byCancellation]]
    );
    expect(
      Object.fromEntries(rows.map((row) => [row.id, [row.status, row.outcome]]))
    ).toEqual({
      [booked]: ["ended", "withdrawn"],
      [byCancellation]: ["active", null],
    });
    const { rows: entries } = await pool.query(
      "select kind from email_campaign_automation_run_events where run_id = $1",
      [booked]
    );
    expect(entries.map(({ kind }) => kind)).toEqual(["withdrawn"]);
  });

  test("keeps a cancellation unprocessed until later plans have withdrawn all its runs", async () => {
    // 6,000 runs: more than one plan withdraws.
    const automations = [];
    for (let index = 0; index < 6; index++) {
      automations.push(
        await automation({ flow: flowOf({ _tag: "ReservationBooked" }) })
      );
    }
    const cancelledAt = now.subtract({ minutes: 5 });
    const confirmedAt = now.subtract({ hours: 48 });
    const reservations = Array.from({ length: 1001 }, (_, index) => ({
      id: workspaceReservationIdSchema.make(`${prefix}-drain-${index}`),
      customer: fixtures.customerId(`drain-${index}`),
    }));
    fixtures.created.reservations.push(...reservations.map(({ id }) => id));
    await Effect.runPromise(
      db.insert(workspaceReservations).values(
        reservations.map(({ id, customer }) => ({
          id,
          authorAccountId: fixtureReservationAuthorId,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(id),
          dotyposCustomerId: customer,
          dotyposReservationId: DotyposReservationIdSchema.make(
            `${id}-dotypos`
          ),
          reservationState: "confirmed" as const,
          reservationConfirmedAt: confirmedAt,
          reservationCancelledAt: cancelledAt,
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
          createdAt: confirmedAt,
        }))
      )
    );
    // Intake takes the first cancellation at once: it has no runs.
    const withRuns = reservations.slice(1);
    for (const { campaignId, versionId } of automations) {
      await Effect.runPromise(
        db.insert(runs).values(
          withRuns.map(({ id, customer }) => ({
            campaignId,
            versionId: versionId as AutomationVersionId,
            dotyposCustomerId: customer,
            triggerKind: "reservation-booked" as const,
            triggerAt: now.subtract({ hours: 1 }),
            triggerReservationId: id,
            status: "active" as const,
            stepId: "send" as AutomationStepId,
            phase: "waiting" as const,
            stepEnteredAt: now.subtract({ hours: 1 }),
            dueAt: now.add({ hours: 1 }),
          }))
        )
      );
    }
    const events = await Effect.runPromise(
      db
        .insert(customerEvents)
        .values(
          reservations.map(({ id, customer }) => ({
            kind: "reservation-cancelled" as const,
            occurredAt: cancelledAt,
            recordedAt: cancelledAt,
            dotyposCustomerId: customer,
            workspaceReservationId: id,
          }))
        )
        .returning({ id: customerEvents.id })
    );
    fixtures.created.events.push(...events.map(({ id }) => id));

    const state = async () => {
      const { rows } = await pool.query(
        `select
           (select count(*)::int from email_campaign_automation_runs
             where campaign_id = any($1) and status = 'active') as "activeRuns",
           (select count(*)::int from email_campaign_automation_runs
             where campaign_id = any($1) and outcome = 'withdrawn') as "withdrawnRuns",
           (select count(*)::int from customer_events
             where id = any($2) and automation_processed_at is not null) as "processedEvents",
           (select count(*)::int from customer_events e
             where e.id = any($2) and e.automation_processed_at is not null
               and exists (
                 select 1 from email_campaign_automation_runs r
                 where r.trigger_reservation_id = e.workspace_reservation_id
                   and r.status = 'active'
               )) as "processedWithActiveRuns"`,
        [
          automations.map(({ campaignId }) => campaignId),
          events.map(({ id }) => id),
        ]
      );
      return rows[0];
    };

    expect((await plan()).withdrawnRuns).toBe(5000);
    expect(await state()).toEqual({
      activeRuns: 1000,
      withdrawnRuns: 5000,
      processedEvents: 1,
      processedWithActiveRuns: 0,
    });

    expect((await plan()).withdrawnRuns).toBe(1000);
    expect(await state()).toEqual({
      activeRuns: 0,
      withdrawnRuns: 6000,
      processedEvents: 1001,
      processedWithActiveRuns: 0,
    });
  }, 120_000);

  test("matches events by the version in force, accepting_since, receipt key and product filter", async () => {
    const versionSwitch = now.subtract({ hours: 2 });
    const switching = await automation({
      flow: flowOf({ _tag: "ReservationFinished" }),
    });
    await seedAutomationVersion(db, {
      campaignId: switching.campaignId,
      purpose: "operational",
      versionNumber: 2,
      flow: flowOf({ _tag: "ReservationStarted" }),
      activatedAt: versionSwitch,
    });
    // Accepting only since after the events.
    await automation({
      flow: flowOf({ _tag: "ReservationFinished" }),
      acceptingSince: now.subtract({ hours: 1 }),
    });
    await automation({
      flow: flowOf({
        _tag: "ReservationFinished",
        product: {
          family: "cowork",
          properties: [
            {
              property: "tier",
              operator: "anyOf",
              value: ["reserved-desk"],
            },
          ],
        },
      }),
    });

    const customer = await fixtures.addCustomer("matching");
    const reservation = await fixtures.book({
      label: "matching",
      customer,
      startsAt: now.subtract({ hours: 6 }),
      endsAt: now.subtract({ hours: 4 }),
    });
    const takenCustomer = await fixtures.addCustomer("matching-taken");
    const taken = await fixtures.book({
      label: "matching-taken",
      customer: takenCustomer,
      startsAt: now.subtract({ hours: 6 }),
      endsAt: now.subtract({ hours: 3 }),
    });
    await pool.query(
      "insert into email_campaign_automation_trigger_receipts (campaign_id, dedup_key, version_id, dotypos_customer_id, disposition) values ($1, $2, $3, $4, 'not-in-audience')",
      [
        switching.campaignId,
        `reservation-finished:${taken}`,
        switching.versionId,
        takenCustomer,
      ]
    );

    // Finished before the switch: version 1 (finished) takes it; `recent`
    // wasn't accepting yet; the product filter doesn't hold.
    const finishedEarly = await fixtures.recordEvent({
      kind: "reservation-finished",
      customer,
      reservationId: reservation,
      occurredAt: now.subtract({ hours: 4 }),
    });
    // Its key is taken in `switching`, and nothing else takes it.
    const finishedTaken = await fixtures.recordEvent({
      kind: "reservation-finished",
      customer: takenCustomer,
      reservationId: taken,
      occurredAt: now.subtract({ hours: 3 }),
    });
    // Started after the switch: version 2 (started) takes it.
    const startedLate = await fixtures.recordEvent({
      kind: "reservation-started",
      customer,
      reservationId: reservation,
      occurredAt: now.subtract({ minutes: 90 }),
    });
    // Started before the switch: version 1 wants finished, so nothing.
    const startedEarly = await fixtures.recordEvent({
      kind: "reservation-started",
      customer: takenCustomer,
      reservationId: taken,
      occurredAt: now.subtract({ hours: 6 }),
    });

    const summary = await plan();

    expect(await eventState(finishedEarly)).toEqual({
      planned: true,
      processed: false,
    });
    expect(await eventState(startedLate)).toEqual({
      planned: true,
      processed: false,
    });
    expect(await eventState(finishedTaken)).toEqual({
      planned: false,
      processed: true,
    });
    expect(await eventState(startedEarly)).toEqual({
      planned: false,
      processed: true,
    });
    expect(summary.eventsMatched).toBeGreaterThanOrEqual(2);
    expect(summary.unitsPlanned).toBeGreaterThanOrEqual(1);

    // One unit owns both of the customer's events.
    const { rows } = await pool.query(
      "select subject, request_cost from email_campaign_automation_work_units where id = (select automation_unit_id from customer_events where id = $1)",
      [finishedEarly]
    );
    expect(rows[0].subject.eventIds.toSorted()).toEqual(
      [finishedEarly, startedLate].toSorted()
    );
    // The everyone gate reads nothing; re-checking one reservation costs one request.
    expect(rows[0].request_cost).toBe(1);

    // Planning again is a no-op for owned and processed events.
    const again = await plan();
    expect(await eventState(finishedEarly)).toEqual({
      planned: true,
      processed: false,
    });
    expect(again.unitsPlanned).toBe(0);
  });

  test("plans an event of a reserved seat only for the automation whose product filter holds", async () => {
    await automation({
      flow: flowOf({
        _tag: "ReservationBooked",
        product: {
          family: "cowork",
          properties: [
            {
              property: "tier",
              operator: "anyOf",
              value: ["reserved-desk"],
            },
          ],
        },
      }),
    });
    const customer = await fixtures.addCustomer("product");
    const openSpace = await fixtures.book({
      label: "product-open",
      customer,
      startsAt: now.add({ hours: 24 }),
      endsAt: now.add({ hours: 26 }),
    });
    const reservedSeat = await fixtures.book({
      label: "product-reserved",
      customer,
      startsAt: now.add({ hours: 30 }),
      endsAt: now.add({ hours: 32 }),
      reservedDesk: true,
    });
    const openEvent = await fixtures.recordEvent({
      kind: "reservation-booked",
      customer,
      reservationId: openSpace,
      occurredAt: now.subtract({ minutes: 2 }),
    });
    const reservedEvent = await fixtures.recordEvent({
      kind: "reservation-booked",
      customer,
      reservationId: reservedSeat,
      occurredAt: now.subtract({ minutes: 1 }),
    });

    await plan();

    expect(await eventState(openEvent)).toEqual({
      planned: false,
      processed: true,
    });
    expect(await eventState(reservedEvent)).toEqual({
      planned: true,
      processed: false,
    });
  });
});
