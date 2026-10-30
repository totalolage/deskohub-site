import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededCustomerReads,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type AutomationConditionFilter,
  AutomationFlow,
  type AutomationFlowType,
  type DatePeriodType,
} from "@deskohub/workspace-admin-api";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { Effect, Exit, Layer, Schema } from "effect";
import {
  customerAccounts,
  customerEvents,
  emailCampaignAudiences,
  emailCampaignAutomationPreviewRows,
  emailCampaignAutomationPreviews,
  emailCampaignAutomations,
  emailCampaignAutomationWorkUnits,
  emailCampaignRecipients,
  emailCampaigns,
  workspaceReservations,
} from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceCondition, AudienceFilter } from "../../audience-filter";
import { AudienceFactsService } from "../../backend/audience-facts.service";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { CampaignRecipientService } from "../../backend/campaign-recipient.service";
import {
  deleteAutomatedCampaigns,
  everyoneFilter,
  seedAutomatedCampaign,
  seedCampaignSend,
} from "../../backend/email-campaigns.test-utils";
import type {
  CampaignAudienceId,
  CampaignId,
} from "../../campaign-identifiers";
import type { AutomationPreviewId } from "../automation-identifiers";
import { automationTickAtOrAfter } from "../automation-ticks";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import { AutomationDryRun } from "./automation-dry-run.service";
import { makeAutomationDryRunner } from "./automation-dry-run.test-utils";
import { automationEngineTestLayer } from "./automation-engine.test-utils";
import {
  databaseInstant,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import {
  automationFlowFixture,
  automationLifecycleTestKit,
} from "./automation-lifecycle.test-utils";
import { makePreviewUnitHandler } from "./automation-preview-unit";
import {
  comeBackOfferFlow,
  lapsedRegularsFilter,
  reviewRequestFlow,
} from "./automation-stories.test-utils";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import { makeAutomationUnitQueueFake } from "./automation-unit-queue.test-utils";

/**
 * A dry run reads every active consent, so the suite runs on a database of
 * its own.
 */
const testDatabase =
  await createWorkspacePostgresSuiteDatabase("automation_dry_run");
afterAll(() => testDatabase?.close());
const runId = crypto.randomUUID().slice(0, 8);
const now = Temporal.Now.instant().round({
  smallestUnit: "second",
  roundingMode: "floor",
});
const ago = (duration: Temporal.DurationLike) => now.subtract(duration);
const pragueOf = (instant: Temporal.Instant) =>
  instant.toZonedDateTimeISO("Europe/Prague");

const customerId = (label: string) =>
  DotyposCustomerIdSchema.make(`dry-run-${runId}-${label}`);

const profile = (
  id: DotyposCustomerId,
  options: { readonly tags?: readonly string[]; readonly email?: string } = {}
) =>
  ({
    id,
    _cloudId: "dry-run-cloud",
    firstName: "Test",
    lastName: id.slice(-4),
    email: options.email ?? testEmailAddress(id),
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    tags: options.tags ?? [],
  }) as DotyposCustomer;

const decodeFlow = Schema.decodeUnknownSync(AutomationFlow);

const send = { _tag: "Send", id: "send" } as const;
const waitHours = (id: string, count: number) => ({
  _tag: "Wait",
  id,
  wait: { _tag: "Duration", count, unit: "hour" },
});
const condition = (id: string, filter: AutomationConditionFilter) => ({
  _tag: "Condition",
  id,
  filter,
});
const noEmailFromThisCampaign: AudienceCondition = {
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: {
    purpose: "any",
    period: { _tag: "AnyTime" },
    campaign: { _tag: "This" },
  },
  operator: "eq",
  value: 0,
};
const taggedVip: AudienceCondition = {
  attribute: "dotyposTags",
  _tag: "Condition",
  operator: "anyOf",
  value: ["vip"],
};
const weekly = (weekday: string) => ({
  weekdays: [weekday],
  hours: [10],
});

/** The mutable Dotypos fake: tests change what it returns between previews. */
const dotyposState = {
  customers: [] as DotyposCustomer[],
  reservations: [] as DotyposReservation[],
  failNextCustomerPage: false,
  customerPageCalls: [] as number[],
  reservationReads: 0,
};
const dotypos = DotyposServiceMock({
  getCustomersByIds: (ids) => {
    dotyposState.customerPageCalls.push(ids.length);
    if (dotyposState.failNextCustomerPage) {
      dotyposState.failNextCustomerPage = false;
      return Effect.fail(
        new DotyposUnavailable({
          operation: "getCustomersByIds",
          reason: "server",
          httpStatus: 503,
        })
      );
    }
    return seededCustomerReads(dotyposState.customers).getCustomersByIds(ids);
  },

  listReservations: (options) => {
    dotyposState.reservationReads += 1;
    return seededReservationReads(dotyposState.reservations).listReservations(
      options
    );
  },
  getReservationsByIds: (ids, readOptions) => {
    const options = { ...readOptions, ids: [...ids] };
    dotyposState.reservationReads += 1;
    return seededReservationReads(dotyposState.reservations)
      .listReservations(options)
      .pipe(
        Effect.flatMap((records) =>
          seededReservationReads(records).getReservationsByIds(ids)
        )
      );
  },
  listReservationsPage: (options) => {
    dotyposState.reservationReads += 1;
    return seededReservationReads(
      dotyposState.reservations
    ).listReservationsPage(options);
  },
  listActiveReservationsPage: (interval, page) =>
    seededReservationReads(
      dotyposState.reservations
    ).listActiveReservationsPage(interval, page),
});

describe.skipIf(!testDatabase)(
  "AutomationDryRun on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;
    const kit = automationLifecycleTestKit(testDatabase, { now });
    const campaignIds: CampaignId[] = [];
    const audienceIds: CampaignAudienceId[] = [];
    const reservationIds: string[] = [];

    const candidates = CampaignCandidateRepository.Default.pipe(
      Layer.provide(testDatabase.layer)
    );
    const audienceFacts = AudienceFactsService.Default.pipe(
      Layer.provide(Layer.mergeAll(candidates, dotypos))
    );
    const capabilities = Layer.mergeAll(
      testDatabase.layer,
      dotypos,
      candidates,
      CampaignRecipientService.Default.pipe(
        Layer.provide(Layer.mergeAll(candidates, audienceFacts))
      ),
      AutomationConditionEvaluation.Default.pipe(
        Layer.provide(Layer.mergeAll(candidates, audienceFacts))
      ),
      AutomationEvaluationFacts.Default.pipe(
        Layer.provide(Layer.merge(testDatabase.layer, dotypos))
      )
    );
    const dryRunLayer = AutomationDryRun.Default.pipe(
      Layer.provide(capabilities)
    );
    const engineLayer = Effect.runPromise(
      makePreviewUnitHandler.pipe(Effect.provide(capabilities))
    ).then((previewHandler) =>
      automationEngineTestLayer({
        database: testDatabase,
        queue: makeAutomationUnitQueueFake(),
        handlers: [previewHandler],
      })
    );

    const run = <A, E>(effect: Effect.Effect<A, E, AutomationDryRun>) =>
      Effect.runPromise(effect.pipe(Effect.provide(dryRunLayer)));
    const runExit = <A, E>(effect: Effect.Effect<A, E, AutomationDryRun>) =>
      Effect.runPromiseExit(effect.pipe(Effect.provide(dryRunLayer)));
    const query = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(effect);

    const start = (campaignId: CampaignId) =>
      run(
        Effect.flatMap(AutomationDryRun, (dryRun) => dryRun.start(campaignId))
      );
    const read = (
      previewId: AutomationPreviewId,
      page: { readonly cursor?: string; readonly limit?: number } = {}
    ) =>
      run(
        Effect.flatMap(AutomationDryRun, (dryRun) =>
          dryRun.get({ previewId, ...page })
        )
      );

    const unitsOf = (previewId: AutomationPreviewId) =>
      query(
        db
          .select()
          .from(emailCampaignAutomationWorkUnits)
          .where(
            like(emailCampaignAutomationWorkUnits.key, `preview:${previewId}:%`)
          )
          .orderBy(asc(emailCampaignAutomationWorkUnits.key))
      );

    /** Delivers one unit: enqueues it as a promotion would, then processes it. */
    const processUnit = async (unitId: string) => {
      await query(
        db
          .update(emailCampaignAutomationWorkUnits)
          .set({ status: "enqueued", enqueuedAt: now })
          .where(
            and(
              eq(emailCampaignAutomationWorkUnits.id, unitId),
              inArray(emailCampaignAutomationWorkUnits.status, [
                "planned",
                "enqueued",
              ])
            )
          )
      );
      return Effect.runPromiseExit(
        Effect.flatMap(AutomationUnitProcessor, (processor) =>
          processor.process(unitId as never)
        ).pipe(Effect.provide(await engineLayer))
      );
    };

    const processAll = async (
      previewId: AutomationPreviewId,
      order: "forward" | "reverse" = "forward"
    ) => {
      const units = await unitsOf(previewId);
      for (const unit of order === "forward" ? units : units.toReversed()) {
        const exit = await processUnit(unit.id);
        expect(Exit.isSuccess(exit)).toBe(true);
      }
    };

    const rowsOf = (previewId: AutomationPreviewId) =>
      query(
        db
          .select()
          .from(emailCampaignAutomationPreviewRows)
          .where(eq(emailCampaignAutomationPreviewRows.previewId, previewId))
          .orderBy(
            asc(emailCampaignAutomationPreviewRows.triggerAt),
            asc(emailCampaignAutomationPreviewRows.dotyposCustomerId)
          )
      );

    const previewRow = (previewId: AutomationPreviewId) =>
      query(
        db
          .select()
          .from(emailCampaignAutomationPreviews)
          .where(eq(emailCampaignAutomationPreviews.id, previewId))
      ).then(([row]) => row!);

    const seedAudience = async (filter: AudienceFilter) => {
      const [audience] = await query(
        db
          .insert(emailCampaignAudiences)
          .values({ title: `Dry run ${runId}`, filter })
          .returning({ id: emailCampaignAudiences.id })
      );
      audienceIds.push(audience!.id);
      return audience!.id;
    };

    /** An automated campaign with its audience and working-copy flow. */
    const seedAutomation = async (input: {
      readonly flow: AutomationFlowType;
      readonly filter?: AudienceFilter;
    }) => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "operational",
        status: "draft",
      });
      campaignIds.push(campaignId);
      const audienceId = await seedAudience(input.filter ?? everyoneFilter);
      await query(
        db
          .update(emailCampaigns)
          .set({ audienceId })
          .where(eq(emailCampaigns.id, campaignId))
      );
      await query(
        db.insert(emailCampaignAutomations).values({
          campaignId,
          flow: Schema.encodeSync(AutomationFlow)(input.flow),
        })
      );
      return campaignId;
    };

    const editFlow = (campaignId: CampaignId, flow: AutomationFlowType) =>
      query(
        db
          .update(emailCampaignAutomations)
          .set({ flow: Schema.encodeSync(AutomationFlow)(flow) })
          .where(eq(emailCampaignAutomations.campaignId, campaignId))
      );

    type SeedReservation = {
      readonly label: string;
      readonly customer: DotyposCustomerId;
      readonly startsAt: Temporal.Instant;
      readonly endsAt: Temporal.Instant;
      /** Dotypos cancelled it; Workspace still has it booked. */
      readonly dotyposCancelled?: boolean;
      /** Workspace cancelled it at this instant. */
      readonly workspaceCancelledAt?: Temporal.Instant;
      /** When it was booked; sixty days ago by default. */
      readonly bookedAt?: Temporal.Instant;
    };

    const reservationIdOf = (label: string) =>
      workspaceReservationIdSchema.make(`dry-run-workspace-${runId}-${label}`);

    const seedReservations = async (
      reservations: readonly SeedReservation[]
    ) => {
      const dotyposReservationIdOf = (label: string) =>
        DotyposReservationIdSchema.make(
          `dry-run-reservation-${runId}-${label}`
        );
      const rows = await query(
        workspaceFixtures(db).reservations(
          reservations.map((reservation) => {
            const confirmedAt = reservation.bookedAt ?? ago({ hours: 24 * 60 });
            const cancelledAt = reservation.workspaceCancelledAt;
            return {
              stage: {
                reservation: cancelledAt ? "cancelled" : "confirmed",
                payment: "paid",
                fulfillment: "fulfilled",
              },
              customer: reservation.customer,
              at: confirmedAt,
              locale: "cs-CZ",
              overrides: {
                id: reservationIdOf(reservation.label),
                dotyposReservationId: dotyposReservationIdOf(reservation.label),
                createdAt: confirmedAt,
                ...(cancelledAt && {
                  reservationConfirmedAt: confirmedAt,
                  reservationCancelledAt: cancelledAt,
                }),
              },
            };
          })
        )
      );
      reservationIds.push(...rows.map(({ id }) => id));
      dotyposState.reservations.push(
        ...reservations.map(
          (reservation) =>
            ({
              id: dotyposReservationIdOf(reservation.label),
              _branchId: "dry-run-branch",
              _cloudId: "dry-run-cloud",
              _customerId: reservation.customer,
              startDate: reservation.startsAt.toString(),
              endDate: reservation.endsAt.toString(),
              seats: "1",
              status: reservation.dotyposCancelled ? "CANCELLED" : "CONFIRMED",
            }) satisfies DotyposReservation
        )
      );
    };

    const moveDotyposReservation = (
      label: string,
      times: {
        readonly startsAt: Temporal.Instant;
        readonly endsAt: Temporal.Instant;
      }
    ) => {
      const id = `dry-run-reservation-${runId}-${label}`;
      dotyposState.reservations = dotyposState.reservations.map(
        (reservation) =>
          reservation.id === id
            ? {
                ...reservation,
                startDate: times.startsAt.toString(),
                endDate: times.endsAt.toString(),
              }
            : reservation
      );
    };

    const seedEvents = async (
      events: readonly {
        readonly kind:
          | "reservation-booked"
          | "reservation-cancelled"
          | "reservation-started"
          | "reservation-finished";
        readonly reservation: string;
        readonly customer: DotyposCustomerId;
        readonly occurredAt: Temporal.Instant;
      }[]
    ) => {
      const rows = events.map((event) => ({
        kind: event.kind,
        occurredAt: event.occurredAt,
        recordedAt: event.occurredAt,
        dotyposCustomerId: event.customer,
        workspaceReservationId: reservationIdOf(event.reservation),
      }));
      const ids: string[] = [];
      for (let index = 0; index < rows.length; index += 500) {
        const inserted = await query(
          db
            .insert(customerEvents)
            .values(rows.slice(index, index + 500))
            .returning({ id: customerEvents.id })
        );
        ids.push(...inserted.map(({ id }) => id));
      }
      return ids;
    };

    /** Customers Workspace knows (one booked reservation each) with Dotypos profiles. */
    const seedScheduleCustomers = async (label: string, count: number) => {
      const ids = Array.from({ length: count }, (_, index) =>
        customerId(`${label}-${String(index).padStart(3, "0")}`)
      );
      dotyposState.customers.push(
        ...ids.map((id, index) =>
          profile(id, { tags: index < 10 ? ["vip"] : [] })
        )
      );
      await seedReservations(
        ids.map((id, index) => ({
          label: `${label}-${index}`,
          customer: id,
          startsAt: ago({ hours: 24 * 40 }),
          endsAt: ago({ hours: 24 * 40 - 2 }),
        }))
      );
      return ids;
    };

    afterAll(async () => {
      await kit.cleanup();
      await deleteAutomatedCampaigns(db, campaignIds);
      if (audienceIds.length > 0) {
        await query(
          db
            .delete(emailCampaignAudiences)
            .where(inArray(emailCampaignAudiences.id, audienceIds))
        );
      }
      if (reservationIds.length > 0) {
        await query(
          db
            .delete(workspaceReservations)
            .where(inArray(workspaceReservations.id, reservationIds))
        );
      }
    });

    test("replays 30 days of events with per-customer overlays", async () => {
      const [alice, bob, carol, dave, erin, frank, gina] = [
        "alice",
        "bob",
        "carol",
        "dave",
        "erin",
        "frank",
        "gina",
      ].map(customerId) as [
        DotyposCustomerId,
        DotyposCustomerId,
        DotyposCustomerId,
        DotyposCustomerId,
        DotyposCustomerId,
        DotyposCustomerId,
        DotyposCustomerId,
      ];
      const finished = (
        label: string,
        customer: DotyposCustomerId,
        at: Temporal.Instant
      ) => ({
        label,
        customer,
        startsAt: at.subtract({ hours: 2 }),
        endsAt: at,
      });
      await seedReservations([
        finished("alice-1", alice, ago({ hours: 24 * 20 })),
        finished("alice-2", alice, ago({ hours: 24 * 19.5 })),
        finished("alice-3", alice, ago({ hours: 24 * 10 })),
        {
          ...finished("bob", bob, ago({ hours: 24 * 5 })),
          dotyposCancelled: true,
        },
        {
          ...finished("carol", carol, ago({ hours: 24 * 8 })),
          workspaceCancelledAt: ago({ hours: 24 * 7.5 }),
        },
        finished("carol-anchor", carol, ago({ hours: 24 * 40 })),
        {
          ...finished("dave", dave, ago({ hours: 24 * 8 })),
          workspaceCancelledAt: ago({ hours: 24 * 6 }),
        },
        finished("dave-anchor", dave, ago({ hours: 24 * 40 })),
        finished("erin", erin, ago({ hours: 12 })),
        // An office visit that started 35 days ago and finished 10 days ago.
        {
          label: "frank",
          customer: frank,
          startsAt: ago({ hours: 24 * 35 }),
          endsAt: ago({ hours: 24 * 10 }),
        },
        // Extended: the sweep saw it finish 15 days ago, then 14 days ago.
        finished("gina", gina, ago({ hours: 24 * 14 })),
      ]);
      const finishedEvent = (
        reservation: string,
        customer: DotyposCustomerId,
        occurredAt: Temporal.Instant
      ) => ({
        kind: "reservation-finished" as const,
        reservation,
        customer,
        occurredAt,
      });
      const [
        e1,
        e2,
        e3,
        bobEvent,
        carolEvent,
        daveEvent,
        erinEvent,
        frankEvent,
        ginaFirst,
        ginaSecond,
      ] = await seedEvents([
        finishedEvent("alice-1", alice, ago({ hours: 24 * 20 })),
        finishedEvent("alice-2", alice, ago({ hours: 24 * 19.5 })),
        finishedEvent("alice-3", alice, ago({ hours: 24 * 10 })),
        finishedEvent("bob", bob, ago({ hours: 24 * 5 })),
        finishedEvent("carol", carol, ago({ hours: 24 * 8 })),
        finishedEvent("dave", dave, ago({ hours: 24 * 8 })),
        finishedEvent("erin", erin, ago({ hours: 12 })),
        finishedEvent("frank", frank, ago({ hours: 24 * 10 })),
        finishedEvent("gina", gina, ago({ hours: 24 * 15 })),
        finishedEvent("gina", gina, ago({ hours: 24 * 14 })),
      ]);
      const campaignId = await seedAutomation({
        flow: decodeFlow({
          trigger: { _tag: "ReservationFinished" },
          steps: [
            condition("first", noEmailFromThisCampaign),
            waitHours("day", 24),
            send,
          ],
        }),
      });

      const started = await start(campaignId);
      expect(started.kind).toBe("replay");
      await processAll(started.previewId);

      const preview = await previewRow(started.previewId);
      expect(preview.status).toBe("completed");
      const mine = new Set<string>([
        alice,
        bob,
        carol,
        dave,
        erin,
        frank,
        gina,
      ]);
      const rows = (await rowsOf(started.previewId)).filter((row) =>
        mine.has(row.dotyposCustomerId)
      );
      const byEvent = new Map(rows.map((row) => [row.customerEventId, row]));

      expect(byEvent.get(e1!)).toMatchObject({
        outcome: "would-send",
        stepId: "send",
        projected: false,
      });
      // On the engine tick: the event's tick, a day later.
      expect(byEvent.get(e1!)?.sendAt).toEqual(
        automationTickAtOrAfter(ago({ hours: 24 * 19 }))
      );
      // D4: the first run is still waiting.
      expect(byEvent.get(e2!)?.outcome).toBe("already-active");
      // The simulated send counts toward "this campaign" afterwards.
      expect(byEvent.get(e3!)).toMatchObject({
        outcome: "condition-failed",
        stepId: "first",
      });
      expect(byEvent.get(bobEvent!)).toMatchObject({
        outcome: "withdrawn",
        stepId: null,
      });
      // Cancelled in Workspace before the send: withdrawn at the send step.
      expect(byEvent.get(carolEvent!)).toMatchObject({
        outcome: "withdrawn",
        stepId: "send",
      });
      // Cancelled only after the email went out.
      expect(byEvent.get(daveEvent!)?.outcome).toBe("would-send");
      expect(byEvent.get(erinEvent!)).toMatchObject({
        outcome: "would-send",
        projected: true,
      });
      expect(byEvent.get(frankEvent!)?.outcome).toBe("would-send");
      expect(byEvent.has(ginaFirst!)).toBe(false);
      expect(byEvent.get(ginaSecond!)?.outcome).toBe("would-send");

      const dryRun = await read(started.previewId);
      expect(dryRun.counts["already-active"]).toBeGreaterThanOrEqual(1);
      expect(dryRun.nextFires).toEqual([]);
      expect(dryRun.frequency).toBeNull();
      expect(dryRun.truncated).toBe(false);
    });

    test("replays a sign-up's account creation but never an existing customer's", async () => {
      const [newcomer, existing] = ["d37-signup", "d37-legacy"].map(
        customerId
      ) as [DotyposCustomerId, DotyposCustomerId];
      dotyposState.customers.push(profile(newcomer), profile(existing));
      // The capture reconciler recorded the existing customer's event before
      // it skipped legacy accounts (D37).
      const accounts = [
        { id: `${newcomer}-account` as CustomerAccountId, legacy: false },
        { id: `${existing}-account` as CustomerAccountId, legacy: true },
      ];
      await query(
        Effect.forEach(accounts, (account) =>
          workspaceFixtures(db).customerAccount(account)
        )
      );
      try {
        const events = await query(
          db
            .insert(customerEvents)
            .values(
              [newcomer, existing].map((customer, index) => ({
                kind: "account-created" as const,
                occurredAt: ago({ hours: 24 * 3 }),
                recordedAt: ago({ hours: 24 * 3 }),
                dotyposCustomerId: customer,
                customerAccountId: accounts[index]!.id,
              }))
            )
            .returning({ id: customerEvents.id })
        );
        const campaignId = await seedAutomation({
          flow: decodeFlow({
            trigger: { _tag: "AccountCreated" },
            steps: [send],
          }),
        });

        const started = await start(campaignId);
        expect(started.kind).toBe("replay");
        await processAll(started.previewId);

        const rows = await rowsOf(started.previewId);
        expect(rows.map((row) => row.customerEventId)).toEqual([events[0]!.id]);
        expect((await read(started.previewId)).eventsTotal).toBe(1);
      } finally {
        // Their events go with the accounts.
        await query(
          db.delete(customerAccounts).where(
            inArray(
              customerAccounts.id,
              accounts.map(({ id }) => id)
            )
          )
        );
      }
    });

    describe("counts as of the replayed moment", () => {
      const triggerAt = ago({ hours: 24 * 10 });

      const noEmailIn = (
        period: DatePeriodType,
        campaignId?: CampaignId
      ): AudienceCondition => ({
        attribute: "campaignEmailCount",
        _tag: "Condition",
        params: {
          purpose: "any",
          period,
          ...(campaignId && {
            campaign: { _tag: "Specific", campaignId },
          }),
        },
        operator: "eq",
        value: 0,
      });

      /**
       * Two customers who finished a visit at `triggerAt`: one got another
       * campaign's email two days before it, the other five days after it.
       */
      const seedCustomers = async (label: string) => {
        const [before, after] = [`${label}-before`, `${label}-after`].map(
          customerId
        ) as [DotyposCustomerId, DotyposCustomerId];
        await seedReservations(
          [before, after].map((customer, index) => ({
            label: `${label}-${index}`,
            customer,
            startsAt: triggerAt.subtract({ hours: 2 }),
            endsAt: triggerAt,
          }))
        );
        const [beforeEvent, afterEvent] = await seedEvents(
          [before, after].map((customer, index) => ({
            kind: "reservation-finished" as const,
            reservation: `${label}-${index}`,
            customer,
            occurredAt: triggerAt,
          }))
        );
        const { campaignId: other, sendId } = await seedCampaignSend(db, {
          purpose: "marketing",
          recipients: [before, after].map((dotyposCustomerId) => ({
            dotyposCustomerId,
            status: "sent" as const,
          })),
        });
        campaignIds.push(other);
        for (const [customer, dispatchedAt] of [
          [before, triggerAt.subtract({ hours: 24 * 2 })],
          [after, triggerAt.add({ hours: 24 * 5 })],
        ] as const) {
          await query(
            db
              .update(emailCampaignRecipients)
              .set({ statusUpdatedAt: dispatchedAt })
              .where(
                and(
                  eq(emailCampaignRecipients.sendId, sendId),
                  eq(emailCampaignRecipients.dotyposCustomerId, customer)
                )
              )
          );
        }
        return { other, before: beforeEvent!, after: afterEvent! };
      };

      /** Each event's outcome in a completed dry run of the flow. */
      const outcomesOf = async (input: {
        readonly steps: readonly unknown[];
        readonly filter?: AudienceFilter;
      }) => {
        const campaignId = await seedAutomation({
          flow: decodeFlow({
            trigger: { _tag: "ReservationFinished" },
            steps: input.steps,
          }),
          ...(input.filter && { filter: input.filter }),
        });
        const started = await start(campaignId);
        await processAll(started.previewId);
        expect((await previewRow(started.previewId)).status).toBe("completed");
        return new Map(
          (await rowsOf(started.previewId)).map((row) => [
            row.customerEventId,
            row.outcome,
          ])
        );
      };

      const sources = [
        { label: "any", campaign: () => undefined },
        { label: "specific", campaign: (other: CampaignId) => other },
      ] as const;

      for (const source of sources) {
        test(`an entry gate counts ${source.label} campaign emails dispatched by the event`, async () => {
          const seeded = await seedCustomers(`gate-${source.label}`);
          const periods: readonly DatePeriodType[] = [
            { _tag: "AnyTime" },
            {
              _tag: "Onward",
              date: pragueOf(triggerAt.subtract({ hours: 24 * 7 }))
                .toPlainDate()
                .toString(),
            },
          ];
          for (const period of periods) {
            const outcomes = await outcomesOf({
              steps: [send],
              filter: {
                _tag: "Group",
                operator: "and",
                filters: [noEmailIn(period, source.campaign(seeded.other))],
              },
            });
            expect(outcomes.get(seeded.before)).toBe("not-in-audience");
            expect(outcomes.get(seeded.after)).toBe("would-send");
          }
        });

        test(`a condition counts ${source.label} campaign emails dispatched by its step`, async () => {
          const seeded = await seedCustomers(`step-${source.label}`);
          const afterTrigger = noEmailIn(
            { _tag: "TriggerWindow", side: "after", count: 30, unit: "day" },
            source.campaign(seeded.other)
          );
          const waitingDays = (days: number) =>
            outcomesOf({
              steps: [
                waitHours("wait", 24 * days),
                condition("check", afterTrigger),
                send,
              ],
            });

          const beforeTheEmail = await waitingDays(2);
          expect(beforeTheEmail.get(seeded.before)).toBe("would-send");
          expect(beforeTheEmail.get(seeded.after)).toBe("would-send");

          const afterTheEmail = await waitingDays(7);
          expect(afterTheEmail.get(seeded.before)).toBe("would-send");
          expect(afterTheEmail.get(seeded.after)).toBe("condition-failed");
        });
      }

      const bookingsIn = (
        period: DatePeriodType,
        value: number
      ): AudienceCondition => ({
        attribute: "reservationCount",
        _tag: "Condition",
        params: { dateBasis: "booking", period },
        operator: "eq",
        value,
      });

      /**
       * Two customers who finished a visit at `triggerAt`, booked fifty days
       * before it, and booked a later visit two days before it; the second
       * booked another five days after it.
       */
      const seedBookers = async (label: string) => {
        const [steady, later] = [`${label}-steady`, `${label}-later`].map(
          customerId
        ) as [DotyposCustomerId, DotyposCustomerId];
        const upcoming = {
          startsAt: triggerAt.add({ hours: 24 * 20 }),
          endsAt: triggerAt.add({ hours: 24 * 20 + 2 }),
        };
        await seedReservations([
          ...[steady, later].flatMap((customer, index) => [
            {
              label: `${label}-${index}`,
              customer,
              startsAt: triggerAt.subtract({ hours: 2 }),
              endsAt: triggerAt,
              bookedAt: triggerAt.subtract({ hours: 24 * 50 }),
            },
            {
              label: `${label}-${index}-early`,
              customer,
              ...upcoming,
              bookedAt: triggerAt.subtract({ hours: 24 * 2 }),
            },
          ]),
          {
            label: `${label}-1-late`,
            customer: later,
            ...upcoming,
            bookedAt: triggerAt.add({ hours: 24 * 5 }),
          },
        ]);
        const [steadyEvent, laterEvent] = await seedEvents(
          [steady, later].map((customer, index) => ({
            kind: "reservation-finished" as const,
            reservation: `${label}-${index}`,
            customer,
            occurredAt: triggerAt,
          }))
        );
        return { steady: steadyEvent!, later: laterEvent! };
      };

      test("an entry gate counts reservations booked by the event", async () => {
        const seeded = await seedBookers("booked-gate");
        const date = (instant: Temporal.Instant) =>
          pragueOf(instant).toPlainDate().toString();
        const weekBefore = date(triggerAt.subtract({ hours: 24 * 7 }));
        const weekAfter = date(triggerAt.add({ hours: 24 * 7 }));
        // What both customers had booked in each period at `triggerAt`.
        const periods: readonly (readonly [DatePeriodType, number])[] = [
          [{ _tag: "AnyTime" }, 2],
          [{ _tag: "Onward", date: weekBefore }, 1],
          [{ _tag: "Range", from: weekBefore, to: weekAfter }, 1],
          [{ _tag: "Until", date: weekAfter }, 2],
          [{ _tag: "TriggerWindow", side: "after", count: 7, unit: "day" }, 0],
        ];
        for (const [period, booked] of periods) {
          const outcomes = await outcomesOf({
            steps: [send],
            filter: {
              _tag: "Group",
              operator: "and",
              filters: [bookingsIn(period, booked)],
            },
          });
          expect(outcomes.get(seeded.steady)).toBe("would-send");
          expect(outcomes.get(seeded.later)).toBe("would-send");
        }
      });

      test("a condition counts reservations booked by its step", async () => {
        const seeded = await seedBookers("booked-step");
        const noBookingAfterTrigger = bookingsIn(
          { _tag: "TriggerWindow", side: "after", count: 30, unit: "day" },
          0
        );
        const waitingDays = (days: number) =>
          outcomesOf({
            steps: [
              waitHours("wait", 24 * days),
              condition("check", noBookingAfterTrigger),
              send,
            ],
          });

        const beforeTheBooking = await waitingDays(2);
        expect(beforeTheBooking.get(seeded.steady)).toBe("would-send");
        expect(beforeTheBooking.get(seeded.later)).toBe("would-send");

        const afterTheBooking = await waitingDays(7);
        expect(afterTheBooking.get(seeded.steady)).toBe("would-send");
        expect(afterTheBooking.get(seeded.later)).toBe("condition-failed");
      });

      test("an entry gate reads reservation statuses as they stood at the event, and marks undated ones", async () => {
        const label = "status-gate";
        const [dated, undated, settled] = ["dated", "undated", "settled"].map(
          (role) => customerId(`${label}-${role}`)
        ) as [DotyposCustomerId, DotyposCustomerId, DotyposCustomerId];
        const customers = [dated, undated, settled];
        const twoDaysAfter = triggerAt.add({ hours: 24 * 2 });
        await seedReservations(
          customers.flatMap((customer, index) => [
            {
              label: `${label}-${index}`,
              customer,
              startsAt: triggerAt.subtract({ hours: 2 }),
              endsAt: triggerAt,
              bookedAt: triggerAt.subtract({ hours: 24 * 50 }),
            },
            {
              label: `${label}-${index}-other`,
              customer,
              startsAt: triggerAt.add({ hours: 24 * 20 }),
              endsAt: triggerAt.add({ hours: 24 * 20 + 2 }),
              bookedAt: triggerAt.subtract({ hours: 24 * 5 }),
              // Cancelled two days after the event: booked at it.
              ...(customer === dated && { workspaceCancelledAt: twoDaysAfter }),
            },
          ])
        );
        // A cancellation that failed is dated only by the row's last update.
        for (const [index, updatedAt] of [
          [1, twoDaysAfter],
          [2, triggerAt.subtract({ hours: 24 * 2 })],
        ] as const) {
          await query(
            db
              .update(workspaceReservations)
              .set({ reservationState: "cancellation_failed", updatedAt })
              .where(
                eq(
                  workspaceReservations.id,
                  reservationIdOf(`${label}-${index}-other`)
                )
              )
          );
        }
        const events = await seedEvents(
          customers.map((customer, index) => ({
            kind: "reservation-finished" as const,
            reservation: `${label}-${index}`,
            customer,
            occurredAt: triggerAt,
          }))
        );
        const campaignId = await seedAutomation({
          flow: decodeFlow({
            trigger: { _tag: "ReservationFinished" },
            steps: [send],
          }),
          filter: {
            _tag: "Group",
            operator: "and",
            filters: [bookingsIn({ _tag: "AnyTime" }, 2)],
          },
        });
        const started = await start(campaignId);
        await processAll(started.previewId);
        const byEvent = new Map(
          (await rowsOf(started.previewId)).map((row) => [
            row.customerEventId,
            row,
          ])
        );
        const [datedEvent, undatedEvent, settledEvent] = events;

        expect(byEvent.get(datedEvent!)).toMatchObject({
          outcome: "would-send",
          reservationStatusesApproximate: false,
        });
        // Read as it is now, which may not be how it stood at the event.
        expect(byEvent.get(undatedEvent!)).toMatchObject({
          outcome: "not-in-audience",
          reservationStatusesApproximate: true,
        });
        // Unchanged since before the event, so exact.
        expect(byEvent.get(settledEvent!)).toMatchObject({
          outcome: "not-in-audience",
          reservationStatusesApproximate: false,
        });
        const dryRun = await read(started.previewId);
        expect(
          dryRun.rows.find((row) => row.customerEventId === undatedEvent)
            ?.reservationStatusesApproximate
        ).toBe(true);
      });

      test("an approximate admission marks the events it holds off and the later ones that count its send", async () => {
        const label = "status-carry";
        const roles = ["carried", "exact"] as const;
        const [carried, exact] = roles.map((role) =>
          customerId(`${label}-${role}`)
        ) as [DotyposCustomerId, DotyposCustomerId];
        const twoDaysAfter = triggerAt.add({ hours: 24 * 2 });
        const visitEnds = [
          triggerAt,
          triggerAt.add({ hours: 1 }),
          triggerAt.add({ hours: 24 * 3 }),
        ];
        await seedReservations(
          [carried, exact].flatMap((customer, index) => [
            ...visitEnds.map((endsAt, visit) => ({
              label: `${label}-${roles[index]}-${visit}`,
              customer,
              startsAt: endsAt.subtract({ hours: 1 }),
              endsAt,
              bookedAt: triggerAt.subtract({ hours: 24 * 50 }),
            })),
            {
              label: `${label}-${roles[index]}-upcoming`,
              customer,
              startsAt: triggerAt.add({ hours: 24 * 20 }),
              endsAt: triggerAt.add({ hours: 24 * 20 + 2 }),
              bookedAt: triggerAt.subtract({ hours: 24 * 5 }),
            },
          ])
        );
        // Only `carried` has an undated change, two days after its first
        // two events and a day before its third.
        await query(
          db
            .update(workspaceReservations)
            .set({
              reservationState: "cancellation_failed",
              updatedAt: twoDaysAfter,
            })
            .where(
              eq(
                workspaceReservations.id,
                reservationIdOf(`${label}-carried-upcoming`)
              )
            )
        );
        const events = await seedEvents(
          [carried, exact].flatMap((customer, index) =>
            visitEnds.map((occurredAt, visit) => ({
              kind: "reservation-finished" as const,
              reservation: `${label}-${roles[index]}-${visit}`,
              customer,
              occurredAt,
            }))
          )
        );
        const campaignId = await seedAutomation({
          flow: decodeFlow({
            trigger: { _tag: "ReservationFinished" },
            steps: [
              condition("first-email", noEmailFromThisCampaign),
              waitHours("wait", 24),
              send,
            ],
          }),
          // At least two bookings, however the undated status reads.
          filter: {
            _tag: "Group",
            operator: "and",
            filters: [
              { ...bookingsIn({ _tag: "AnyTime" }, 1), operator: "gt" },
            ],
          },
        });
        const started = await start(campaignId);
        await processAll(started.previewId);
        const byEvent = new Map(
          (await rowsOf(started.previewId)).map((row) => [
            row.customerEventId,
            row,
          ])
        );
        const outcomes = (ids: readonly (string | undefined)[]) =>
          ids.map((id) => {
            const row = byEvent.get(id!);
            return [row?.outcome, row?.reservationStatusesApproximate];
          });

        // The admission read the undated status; the second event is held
        // off by its run, and the third counts its send.
        expect(outcomes(events.slice(0, 3))).toEqual([
          ["would-send", true],
          ["already-active", true],
          ["condition-failed", true],
        ]);
        expect(outcomes(events.slice(3))).toEqual([
          ["would-send", false],
          ["already-active", false],
          ["condition-failed", false],
        ]);
      });
    });

    test("replays only the latest 1,000 events and counts the rest", async () => {
      const customers = ["t1", "t2", "t3"].map(customerId);
      const labels = Array.from(
        { length: 1005 },
        (_, index) => `many-${index}`
      );
      await seedReservations(
        labels.map((label, index) => ({
          label,
          customer: customers[index % 3]!,
          startsAt: ago({ hours: 24 * 40 }),
          endsAt: ago({ hours: 24 * 40 - 1 }),
        }))
      );
      await seedEvents(
        labels.map((label, index) => ({
          kind: "reservation-cancelled",
          reservation: label,
          customer: customers[index % 3]!,
          // A customer's events a tick apart, so none is held off.
          occurredAt: ago({ hours: 1, minutes: 5 * index }),
        }))
      );
      const campaignId = await seedAutomation({
        flow: decodeFlow({
          trigger: {
            _tag: "ReservationCancelled",
            product: { family: "cowork", properties: [] },
          },
          steps: [send],
        }),
      });

      const started = await start(campaignId);
      await processAll(started.previewId);

      const dryRun = await read(started.previewId);
      expect(dryRun.status).toBe("completed");
      expect(dryRun.eventsTotal).toBeGreaterThanOrEqual(1005);
      expect(dryRun.truncated).toBe(true);
      const rows = (await rowsOf(started.previewId)).filter((row) =>
        customers.includes(row.dotyposCustomerId)
      );
      // Other suites' cancellations may share the window, never more than 1,000 rows.
      expect(rows.length).toBeLessThanOrEqual(1000);
      expect(
        rows.some((row) =>
          row.triggerAt.equals(ago({ hours: 1, minutes: 5 * 1004 }))
        )
      ).toBe(false);
      expect(rows.every((row) => row.outcome === "would-send")).toBe(true);
    });

    test("an event trigger with no events completes at once", async () => {
      const campaignId = await seedAutomation({
        flow: decodeFlow({
          trigger: {
            _tag: "ReservationBooked",
            product: {
              family: "office",
              properties: [{ property: "seats", operator: "gte", value: 999 }],
            },
          },
          steps: [send],
        }),
      });
      const started = await start(campaignId);
      expect(started).toMatchObject({
        status: "completed",
        unitsTotal: 0,
        kind: "replay",
      });
      expect(await unitsOf(started.previewId)).toEqual([]);
    });

    test("a reschedule in Dotypos changes the next preview without local writes", async () => {
      const hank = customerId("hank");
      await seedReservations([
        {
          label: "hank",
          customer: hank,
          startsAt: ago({ hours: 24 * 6 }),
          endsAt: ago({ hours: 24 * 6 - 2 }),
        },
      ]);
      const [event] = await seedEvents([
        {
          kind: "reservation-started",
          reservation: "hank",
          customer: hank,
          occurredAt: ago({ hours: 24 * 6 }),
        },
      ]);
      const flow = (sendId: string) =>
        decodeFlow({
          trigger: { _tag: "ReservationStarted" },
          steps: [{ _tag: "Send", id: sendId }],
        });
      const campaignId = await seedAutomation({ flow: flow("send") });

      const first = await start(campaignId);
      await processAll(first.previewId);
      expect(
        (await rowsOf(first.previewId)).find(
          (row) => row.customerEventId === event
        )?.outcome
      ).toBe("would-send");

      const localBefore = await query(
        db
          .select()
          .from(customerEvents)
          .where(eq(customerEvents.dotyposCustomerId, hank))
      );
      moveDotyposReservation("hank", {
        startsAt: ago({ hours: 24 * 5 }),
        endsAt: ago({ hours: 24 * 5 - 2 }),
      });
      await editFlow(campaignId, flow("send-again"));
      const second = await start(campaignId);
      expect(second.previewId).not.toBe(first.previewId);
      await processAll(second.previewId);

      expect(
        (await rowsOf(second.previewId)).some(
          (row) => row.customerEventId === event
        )
      ).toBe(false);
      expect(
        await query(
          db
            .select()
            .from(customerEvents)
            .where(eq(customerEvents.dotyposCustomerId, hank))
        )
      ).toEqual(localBefore);
    });

    test("a Workspace-cancelled reservation skips the live re-check, which compares at stored precision, and a cancellation trigger is never withdrawn", async () => {
      const [moved, movedCancelled, sameMoment, cancellation] = [
        "recheck-moved",
        "recheck-moved-cancelled",
        "recheck-same-moment",
        "recheck-cancellation",
      ].map(customerId) as [
        DotyposCustomerId,
        DotyposCustomerId,
        DotyposCustomerId,
        DotyposCustomerId,
      ];
      const finishedAt = ago({ hours: 24 * 9 });
      // Dotypos already reports each visit as it stands now.
      const extended = {
        startsAt: finishedAt.subtract({ hours: 2 }),
        endsAt: finishedAt.add({ hours: 1 }),
      };
      const cancelledAt = ago({ minutes: 31 });
      await seedReservations([
        { label: "recheck-moved", customer: moved, ...extended },
        {
          label: "recheck-moved-cancelled",
          customer: movedCancelled,
          ...extended,
          workspaceCancelledAt: finishedAt.add({ hours: 12 }),
        },
        {
          // Later than the event only below the microseconds it's stored at.
          label: "recheck-same-moment",
          customer: sameMoment,
          startsAt: finishedAt.subtract({ hours: 2 }),
          endsAt: finishedAt.add({ nanoseconds: 500 }),
        },
        {
          label: "recheck-cancellation",
          customer: cancellation,
          startsAt: ago({ hours: 24 * 3 }),
          endsAt: ago({ hours: 24 * 3 - 2 }),
          workspaceCancelledAt: cancelledAt,
        },
      ]);
      const finishedEvent = (
        reservation: string,
        customer: DotyposCustomerId
      ) => ({
        kind: "reservation-finished" as const,
        reservation,
        customer,
        occurredAt: finishedAt,
      });
      const [movedEvent, movedCancelledEvent, sameMomentEvent] =
        await seedEvents([
          finishedEvent("recheck-moved", moved),
          finishedEvent("recheck-moved-cancelled", movedCancelled),
          finishedEvent("recheck-same-moment", sameMoment),
        ]);
      const [cancellationEvent] = await seedEvents([
        {
          kind: "reservation-cancelled",
          reservation: "recheck-cancellation",
          customer: cancellation,
          // The newest cancellation, so the 1,000-event cap keeps it.
          occurredAt: cancelledAt.add({ minutes: 1 }),
        },
      ]);
      const finishedCampaign = await seedAutomation({
        flow: decodeFlow({
          trigger: { _tag: "ReservationFinished" },
          steps: [waitHours("day", 24), send],
        }),
      });
      const cancelledCampaign = await seedAutomation({
        flow: decodeFlow({
          trigger: { _tag: "ReservationCancelled" },
          steps: [send],
        }),
      });

      const finished = await start(finishedCampaign);
      const cancelled = await start(cancelledCampaign);
      // Neither audience nor flow reads Dotypos, so only the re-check costs
      // requests: one per 100 of a chunk's reservations, none for cancellations.
      const finishedUnits = await unitsOf(finished.previewId);
      expect(finishedUnits.length).toBeGreaterThan(0);
      expect(finishedUnits.filter((unit) => unit.requestCost === 0)).toEqual(
        []
      );
      expect(
        (await unitsOf(cancelled.previewId)).filter(
          (unit) => unit.requestCost !== 0
        )
      ).toEqual([]);
      await processAll(finished.previewId);
      await processAll(cancelled.previewId);

      const byEvent = new Map(
        [
          ...(await rowsOf(finished.previewId)),
          ...(await rowsOf(cancelled.previewId)),
        ].map((row) => [row.customerEventId, row])
      );
      // The visit moved past the event, so the sweep's later event stands for it.
      expect(byEvent.has(movedEvent!)).toBe(false);
      // Cancelled in Workspace before the send: the pre-submit check withdraws it.
      expect(byEvent.get(movedCancelledEvent!)).toMatchObject({
        outcome: "withdrawn",
        stepId: "send",
      });
      expect(byEvent.get(sameMomentEvent!)?.outcome).toBe("would-send");
      expect(byEvent.get(cancellationEvent!)?.outcome).toBe("would-send");
    });

    test("a saved audience edited after planning still evaluates", async () => {
      const mia = customerId("mia");
      await seedReservations([
        {
          label: "mia",
          customer: mia,
          startsAt: ago({ hours: 24 * 20 }),
          endsAt: ago({ hours: 24 * 20 - 2 }),
        },
      ]);
      const [event] = await seedEvents([
        {
          kind: "reservation-cancelled",
          reservation: "mia",
          customer: mia,
          // The newest cancellation, so the 1,000-event cap keeps it.
          occurredAt: ago({ minutes: 30 }),
        },
      ]);
      const savedAudience = await seedAudience({
        attribute: "hasAccount",
        _tag: "Condition",
        operator: "is",
        value: true,
      } as AudienceFilter);
      const campaignId = await seedAutomation({
        flow: decodeFlow({
          trigger: { _tag: "ReservationCancelled" },
          steps: [
            condition("member", {
              _tag: "InAudience",
              audienceId: savedAudience,
              operator: "in",
            }),
            send,
          ],
        }),
      });
      const started = await start(campaignId);
      const [unit] = await unitsOf(started.previewId);
      expect(unit?.requestCost).toBe(0);

      // Now the audience needs visits, which the unit didn't plan for (D32).
      await query(
        db
          .update(emailCampaignAudiences)
          .set({
            filter: {
              attribute: "lastVisit",
              _tag: "Condition",
              operator: "in",
              value: { _tag: "Last", count: 1, unit: "year" },
            } as AudienceFilter,
          })
          .where(eq(emailCampaignAudiences.id, savedAudience))
      );
      const readsBefore = dotyposState.reservationReads;
      await processAll(started.previewId);

      expect((await previewRow(started.previewId)).status).toBe("completed");
      expect(dotyposState.reservationReads).toBeGreaterThan(readsBefore);
      expect(
        (await rowsOf(started.previewId)).find(
          (row) => row.customerEventId === event
        )?.outcome
      ).toBe("would-send");
    });

    describe("schedule triggers", () => {
      let customers: readonly DotyposCustomerId[] = [];
      const scheduleFlow = (weekday: string, conditionId = "vip") =>
        decodeFlow({
          trigger: { _tag: "Schedule", calendar: weekly(weekday) },
          steps: [condition(conditionId, taggedVip), send],
        });

      test("seeds the pool", async () => {
        customers = await seedScheduleCustomers("pool", 250);
        expect(customers.length).toBe(250);
      });

      test("a draft previews its own next fires and entrants", async () => {
        const campaignId = await seedAutomation({
          flow: scheduleFlow("monday"),
        });
        const started = await start(campaignId);
        expect(started.kind).toBe("schedule");
        const fire = Temporal.Instant.from(started.asOf);
        expect(pragueOf(fire).dayOfWeek).toBe(1);
        expect(pragueOf(fire).hour).toBe(10);

        await processAll(started.previewId);
        const dryRun = await read(started.previewId);
        expect(dryRun.status).toBe("completed");
        expect(dryRun.nextFires).toHaveLength(5);
        expect(dryRun.nextFires[0]).toBe(fire.toString());
        expect(
          dryRun.nextFires.every(
            (at) => pragueOf(Temporal.Instant.from(at)).dayOfWeek === 1
          )
        ).toBe(true);
        expect(dryRun.frequency).toEqual({
          maxFiresPerHour: 1,
          firesMoreThanHourly: false,
        });
        expect(dryRun.emails.map(({ locale }) => locale)).toEqual(["cs-CZ"]);

        const rows = new Map(
          (await rowsOf(started.previewId)).map((row) => [
            row.dotyposCustomerId,
            row,
          ])
        );
        expect(rows.get(customers[0]!)).toMatchObject({
          outcome: "would-send",
          stepId: "send",
          projected: true,
        });
        expect(rows.get(customers[0]!)?.sendAt?.equals(fire)).toBe(true);
        expect(rows.get(customers[20]!)).toMatchObject({
          outcome: "condition-failed",
          stepId: "vip",
        });
      });

      test("an active Monday v1 edited to Wednesdays previews Wednesdays", async () => {
        // Activated through the lifecycle, so v1 fires on Mondays.
        const { campaignId } = await kit.seedActive(scheduleFlow("monday"));
        const [active] = await query(
          db
            .select({ nextFireAt: emailCampaignAutomations.nextFireAt })
            .from(emailCampaignAutomations)
            .where(eq(emailCampaignAutomations.campaignId, campaignId))
        );
        const nextMonday = active!.nextFireAt!;
        expect(pragueOf(nextMonday).dayOfWeek).toBe(1);
        await kit.run(
          kit.lifecycle((lifecycle) =>
            lifecycle.updateFlow({
              campaignId,
              flow: scheduleFlow("wednesday"),
            })
          )
        );

        const started = await start(campaignId);
        expect(pragueOf(Temporal.Instant.from(started.asOf)).dayOfWeek).toBe(3);
        const dryRun = await read(started.previewId);
        expect(
          dryRun.nextFires.every(
            (at) => pragueOf(Temporal.Instant.from(at)).dayOfWeek === 3
          )
        ).toBe(true);
        const [automation] = await query(
          db
            .select({ nextFireAt: emailCampaignAutomations.nextFireAt })
            .from(emailCampaignAutomations)
            .where(eq(emailCampaignAutomations.campaignId, campaignId))
        );
        expect(automation?.nextFireAt?.equals(nextMonday)).toBe(true);
      });

      test("units completing in any order or retried write no duplicates", async () => {
        const campaignId = await seedAutomation({
          flow: scheduleFlow("friday"),
        });
        const started = await start(campaignId);
        const units = await unitsOf(started.previewId);
        expect(units.length).toBeGreaterThanOrEqual(3);

        // The last unit fails its Dotypos read once and is redelivered.
        const [last, ...rest] = units.toReversed();
        dotyposState.failNextCustomerPage = true;
        expect(Exit.isFailure(await processUnit(last!.id))).toBe(true);
        expect(Exit.isSuccess(await processUnit(last!.id))).toBe(true);
        for (const unit of rest) {
          expect(Exit.isSuccess(await processUnit(unit.id))).toBe(true);
        }

        const preview = await previewRow(started.previewId);
        expect(preview).toMatchObject({
          status: "completed",
          unitsDone: units.length,
        });
        const rows = await rowsOf(started.previewId);
        const subjects = units.flatMap(
          (unit) => (unit.subject as { customerIds: string[] }).customerIds
        );
        expect(rows.length).toBe(subjects.length);
        expect(new Set(rows.map((row) => row.dotyposCustomerId)).size).toBe(
          rows.length
        );
        expect(
          Object.values(preview.counts).reduce((sum, value) => sum + value, 0)
        ).toBe(rows.length);
      });

      test("returns the dry run of the current draft and supersedes an older one", async () => {
        const campaignId = await seedAutomation({
          flow: scheduleFlow("tuesday"),
        });
        const first = await start(campaignId);
        expect((await start(campaignId)).previewId).toBe(first.previewId);

        await editFlow(campaignId, scheduleFlow("tuesday", "vip-only"));
        const second = await start(campaignId);
        expect(second.previewId).not.toBe(first.previewId);
        expect((await previewRow(first.previewId)).status).toBe("superseded");
        expect(
          (await unitsOf(first.previewId)).every(
            (unit) => unit.status === "dropped"
          )
        ).toBe(true);
      });

      test("an edit mid-job supersedes it", async () => {
        const campaignId = await seedAutomation({
          flow: scheduleFlow("thursday"),
        });
        const started = await start(campaignId);
        const [first, second, ...rest] = await unitsOf(started.previewId);
        expect(Exit.isSuccess(await processUnit(first!.id))).toBe(true);
        const written = (await rowsOf(started.previewId)).length;

        await editFlow(campaignId, scheduleFlow("thursday", "edited"));
        expect(Exit.isSuccess(await processUnit(second!.id))).toBe(true);

        expect((await previewRow(started.previewId)).status).toBe("superseded");
        expect((await rowsOf(started.previewId)).length).toBe(written);
        const units = await unitsOf(started.previewId);
        expect(units.find((unit) => unit.id === second!.id)?.status).toBe(
          "done"
        );
        // Planned units drop; ones a hand-off already enqueued are marked.
        expect(
          units
            .filter((unit) => rest.some(({ id }) => id === unit.id))
            .every(
              (unit) =>
                unit.status === "dropped" ||
                (unit.status === "enqueued" && unit.cancelRequestedAt !== null)
            )
        ).toBe(true);
      });

      test("a running dry run without progress for an hour fails", async () => {
        const campaignId = await seedAutomation({
          flow: scheduleFlow("saturday"),
        });
        const started = await start(campaignId);
        await query(
          db
            .update(emailCampaignAutomationPreviews)
            .set({ createdAt: ago({ hours: 2 }) })
            .where(eq(emailCampaignAutomationPreviews.id, started.previewId))
        );

        const dryRun = await read(started.previewId);
        expect(dryRun).toMatchObject({
          status: "failed",
          errorCode: "preview-stalled",
        });
        expect((await previewRow(started.previewId)).status).toBe("failed");
        expect(
          (await unitsOf(started.previewId)).every(
            (unit) => unit.status === "dropped"
          )
        ).toBe(true);
        // A new start replaces it.
        const restarted = await start(campaignId);
        expect(restarted.previewId).not.toBe(started.previewId);
      });

      test("hydrates at most 200 customers per page, live", async () => {
        const campaignId = await seedAutomation({
          flow: scheduleFlow("sunday"),
        });
        const started = await start(campaignId);
        await processAll(started.previewId);

        dotyposState.customerPageCalls = [];
        const page = await read(started.previewId);
        expect(page.rows.length).toBe(200);
        expect(page.customers.length).toBeLessThanOrEqual(200);
        expect(page.customers.length).toBe(
          new Set(page.rows.map(({ customerId }) => customerId)).size
        );
        expect(dotyposState.customerPageCalls.length).toBeLessThanOrEqual(4);
        expect(dotyposState.customerPageCalls.every((ids) => ids <= 200)).toBe(
          true
        );
        const named = page.customers.find(
          ({ customerId }) => customerId === customers[0]
        );
        expect(named?.email).toBe(testEmailAddress(customers[0]!));
        expect(page.nextCursor).not.toBeNull();

        const next = await read(started.previewId, {
          cursor: page.nextCursor!,
        });
        expect(next.rows.length).toBeGreaterThan(0);
        expect(
          next.rows.some(({ customerId }) =>
            page.rows.some((row) => row.customerId === customerId)
          )
        ).toBe(false);
      });

      test("a solo unit missing its deadline three times reports unavailable", async () => {
        const campaignId = await seedAutomation({
          flow: scheduleFlow("monday", "late"),
        });
        const started = await start(campaignId);
        const [unit] = await unitsOf(started.previewId);
        await query(
          db
            .update(emailCampaignAutomationWorkUnits)
            .set({ deadlineMisses: 3 })
            .where(eq(emailCampaignAutomationWorkUnits.id, unit!.id))
        );
        expect(Exit.isSuccess(await processUnit(unit!.id))).toBe(true);
        const rows = await rowsOf(started.previewId);
        expect(rows.length).toBe(
          (unit!.subject as { customerIds: string[] }).customerIds.length
        );
        expect(rows.every((row) => row.outcome === "unavailable")).toBe(true);
      });

      test("refuses an automation without a flow", async () => {
        const campaignId = await seedAutomation({
          flow: scheduleFlow("monday", "x"),
        });
        await query(
          db
            .update(emailCampaignAutomations)
            .set({ flow: null })
            .where(eq(emailCampaignAutomations.campaignId, campaignId))
        );
        const noFlow = await runExit(
          Effect.flatMap(AutomationDryRun, (dryRun) => dryRun.start(campaignId))
        );
        expect(noFlow).toMatchObject({
          _tag: "Failure",
          cause: { reasons: [{ error: { _tag: "AutomationFlowInvalid" } }] },
        });
      });
    });
  }
);

describe.skipIf(!testDatabase)(
  "AutomationDryRun and the engine agree (§8)",
  async () => {
    if (!testDatabase) return;
    const { pool } = testDatabase;
    const instant = (value: string) => Temporal.Instant.from(value);
    const iso = (value: Date | string | null | undefined) =>
      databaseInstant(value)?.toString() ?? null;
    const scenario = await makeAutomationEngineScenario({
      database: testDatabase,
      now: instant("2026-10-13T06:00:00Z"),
      prefix: `dry-run-parity-${runId}`,
    });
    const dryRunner = makeAutomationDryRunner({
      database: testDatabase,
      dotypos: scenario.dotypos.layer,
    });
    const { fixtures, kit, read } = scenario;
    afterAll(() => scenario.cleanup());

    type PreviewRow = {
      readonly dotypos_customer_id: string;
      readonly customer_event_id: string | null;
      readonly outcome: string;
      readonly step_id: string | null;
      readonly send_at: Date | string | null;
    };
    const previewRows = async (previewId: AutomationPreviewId) =>
      (
        await pool.query<PreviewRow>(
          "select * from email_campaign_automation_preview_rows where preview_id = $1 order by trigger_at, dotypos_customer_id",
          [previewId]
        )
      ).rows;

    /**
     * Starts a dry run of the active automation at `at` and processes it,
     * then runs the engine on the same Dotypos data from the same instant
     * until every run of the campaign has ended. The dry run's rows are
     * read once it completes, since the planner prunes week-old dry runs.
     * The automation is archived afterwards, so later tests' schedules
     * don't fire it.
     */
    const dryRunThenEngine = async (
      active: {
        readonly campaignId: CampaignId;
        readonly previewId: AutomationPreviewId;
      },
      at: Temporal.Instant,
      until: Temporal.Instant
    ) => {
      const { campaignId } = active;
      await scenario.prepare(at);
      // The kit's stand-in for the dry run that let it activate.
      await pool.query(
        "update email_campaign_automation_previews set status = 'superseded' where id = $1",
        [active.previewId]
      );
      const started = await dryRunner.start(campaignId, at);
      const previewed = await scenario.runUntil({
        from: at,
        until: at,
        sameInstant: true,
        settled: async () => {
          const { rows } = await pool.query<{ status: string }>(
            "select status from email_campaign_automation_previews where id = $1",
            [started.previewId]
          );
          return rows[0]?.status === "completed";
        },
      });
      expect(previewed.settled).toBe(true);
      const rows = await previewRows(started.previewId);
      // The engine on the cron's ticks, which the dry run's times model.
      const progress = await scenario.runUntil({
        from: at,
        until,
        onTicks: true,
        settled: async () => {
          const runs = await read.runs(campaignId);
          return runs.length > 0 && runs.every((run) => run.status === "ended");
        },
      });
      expect(progress.settled).toBe(true);
      await scenario.lifecycle(
        (lifecycle) => lifecycle.archive(campaignId),
        progress.at
      );
      return { started, rows, runs: await read.runs(campaignId) };
    };

    /** The columns of an ended run that parity compares. */
    type EndedRun = {
      readonly outcome: string | null;
      readonly step_id: string;
      readonly step_entered_at: Date | string;
    };
    /** A run's end as a dry-run row states it: the send instant is when the run reached its send step. */
    const engineOutcome = (run: EndedRun) => ({
      outcome: run.outcome === "sent" ? "would-send" : run.outcome,
      stepId: run.step_id,
      sendAt: run.outcome === "sent" ? iso(run.step_entered_at) : null,
    });
    const rowOutcome = (row: PreviewRow) => ({
      outcome: row.outcome,
      stepId: row.step_id,
      sendAt: iso(row.send_at),
    });

    test("story 1: identical send instants for the same events", async () => {
      const active = await kit.seedActive(reviewRequestFlow, {
        at: instant("2026-10-13T06:00:00Z"),
      });
      const second = await fixtures.addCustomer("story1-second");
      const once = await fixtures.addCustomer("story1-once");
      const finishedVisit = async (
        label: string,
        customer: DotyposCustomerId,
        endsAt: Temporal.Instant
      ) => {
        const reservationId = await fixtures.book({
          label,
          customer,
          startsAt: endsAt.subtract({ hours: 8 }),
          endsAt,
        });
        return fixtures.recordEvent({
          kind: "reservation-finished",
          customer,
          occurredAt: endsAt,
          reservationId,
        });
      };
      // Before activation: the dry run replays it, the engine ignores it.
      const earlier = await finishedVisit(
        "story1-second-first",
        second,
        instant("2026-10-01T15:00:00Z")
      );
      await finishedVisit(
        "story1-second-second",
        second,
        instant("2026-10-13T15:00:00Z")
      );
      await finishedVisit("story1-once", once, instant("2026-10-13T15:00:00Z"));

      const { started, rows, runs } = await dryRunThenEngine(
        active,
        instant("2026-10-13T15:05:00Z"),
        instant("2026-10-15T00:00:00Z")
      );

      expect(started.kind).toBe("replay");
      expect(runs).toHaveLength(2);
      for (const run of runs) {
        const row = rows.find(
          (candidate) => candidate.customer_event_id === run.trigger_event_id
        );
        expect(row).toBeDefined();
        expect(rowOutcome(row!)).toEqual(engineOutcome(run));
      }
      const byCustomer = new Map(
        runs.map((run) => [run.dotypos_customer_id, engineOutcome(run)])
      );
      // 10:00 in Prague the next day, after the 2-hour settle.
      expect(byCustomer.get(second)).toEqual({
        outcome: "would-send",
        stepId: "send",
        sendAt: "2026-10-14T08:00:00Z",
      });
      expect(byCustomer.get(once)).toMatchObject({
        outcome: "condition-failed",
        stepId: "second-visit-within-a-month",
      });
      expect(
        rows.find((row) => row.customer_event_id === earlier)
      ).toMatchObject({ outcome: "condition-failed" });
    });

    test("story 2: identical send instants for the same fire", async () => {
      const activatedAt = instant("2026-10-18T10:00:00Z");
      const active = await kit.seedActive(comeBackOfferFlow, {
        at: activatedAt,
        audienceFilter: lapsedRegularsFilter,
      });
      const visit = async (
        label: string,
        customer: DotyposCustomerId,
        startsAt: string
      ) =>
        fixtures.book({
          label,
          customer,
          startsAt: instant(startsAt),
          endsAt: instant(startsAt).add({ hours: 8 }),
        });
      const regular = await fixtures.addCustomer("story2-regular");
      await visit("story2-regular-1", regular, "2026-07-10T07:00:00Z");
      await visit("story2-regular-2", regular, "2026-08-14T07:00:00Z");
      const recent = await fixtures.addCustomer("story2-recent");
      await visit("story2-recent-1", recent, "2026-07-10T07:00:00Z");
      await visit("story2-recent-2", recent, "2026-10-08T07:00:00Z");
      const single = await fixtures.addCustomer("story2-single");
      await visit("story2-single-1", single, "2026-07-10T07:00:00Z");

      const { started, rows, runs } = await dryRunThenEngine(
        active,
        activatedAt,
        instant("2026-10-19T09:00:00Z")
      );

      // Monday 10:00 in Prague.
      const fire = "2026-10-19T08:00:00Z";
      expect(started).toMatchObject({ kind: "schedule", asOf: fire });
      const rowsByCustomer = new Map(
        rows.map((row) => [row.dotypos_customer_id, rowOutcome(row)])
      );
      const runsByCustomer = new Map(
        runs.map((run) => [run.dotypos_customer_id, engineOutcome(run)])
      );
      expect(
        new Map(
          [...rowsByCustomer].filter(([, row]) => row.outcome === "would-send")
        )
      ).toEqual(new Map(runsByCustomer));
      expect(runsByCustomer.get(regular)).toEqual({
        outcome: "would-send",
        stepId: "send",
        sendAt: fire,
      });
      expect(runsByCustomer.has(recent)).toBe(false);
      expect(runsByCustomer.has(single)).toBe(false);
    });

    test("§8.1: at 10:30 on a Monday both send next Monday at 10:00", async () => {
      const mondayAtHalfPastTen = instant("2026-10-19T08:30:00Z");
      const active = await kit.seedActive(
        automationFlowFixture({
          trigger: {
            _tag: "Schedule",
            calendar: { weekdays: ["monday"], hours: [10] },
          },
          steps: [
            {
              _tag: "Wait",
              id: "ten-oclock",
              wait: { _tag: "Calendar", expression: { hours: [10] } },
            },
            { _tag: "Send", id: "send" },
          ],
        }),
        { at: mondayAtHalfPastTen }
      );
      const customer = await fixtures.addCustomer("half-past-ten");
      await fixtures.book({
        label: "half-past-ten",
        customer,
        startsAt: instant("2026-09-01T07:00:00Z"),
        endsAt: instant("2026-09-01T15:00:00Z"),
      });

      const { started, rows, runs } = await dryRunThenEngine(
        active,
        mondayAtHalfPastTen,
        instant("2026-10-26T10:00:00Z")
      );

      // 10:00 in Prague on 26 October, after the switch to winter time.
      const nextMonday = "2026-10-26T09:00:00Z";
      expect(started).toMatchObject({ kind: "schedule", asOf: nextMonday });
      const row = rows.find(
        (candidate) => candidate.dotypos_customer_id === customer
      );
      const run = runs.find(
        (candidate) => candidate.dotypos_customer_id === customer
      );
      expect(rowOutcome(row!)).toEqual({
        outcome: "would-send",
        stepId: "send",
        sendAt: nextMonday,
      });
      expect(engineOutcome(run!)).toEqual(rowOutcome(row!));
      for (const other of runs) {
        expect(
          rowOutcome(
            rows.find(
              (candidate) =>
                candidate.dotypos_customer_id === other.dotypos_customer_id
            )!
          )
        ).toEqual(engineOutcome(other));
      }
    });
  }
);
