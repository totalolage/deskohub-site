import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
  ExternalAPIError,
} from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededCustomerReads,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import {
  type AutomationConditionFilter,
  AutomationFlow,
  type AutomationFlowType,
} from "@deskohub/workspace-admin-api";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { Effect, Exit, Layer, Schema } from "effect";
import {
  customerEvents,
  emailCampaignAudiences,
  emailCampaignAutomationPreviewRows,
  emailCampaignAutomationPreviews,
  emailCampaignAutomations,
  emailCampaignAutomationWorkUnits,
  emailCampaigns,
  workspaceReservations,
} from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceCondition, AudienceFilter } from "../../audience-filter";
import { AudienceFactsService } from "../../backend/audience-facts.service";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { CampaignRecipientService } from "../../backend/campaign-recipient.service";
import {
  deleteAutomatedCampaigns,
  everyoneFilter,
  seedAutomatedCampaign,
} from "../../backend/email-campaigns.test-utils";
import type {
  CampaignAudienceId,
  CampaignId,
} from "../../campaign-identifiers";
import type { AutomationPreviewId } from "../automation-identifiers";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import { AutomationDryRun } from "./automation-dry-run.service";
import { automationEngineTestLayer } from "./automation-engine.test-utils";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { automationLifecycleTestKit } from "./automation-lifecycle.test-utils";
import { makePreviewUnitHandler } from "./automation-preview-unit";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import { makeAutomationUnitQueueFake } from "./automation-unit-queue.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();
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
    email: options.email ?? `${id}@deskohub.test`,
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
  getCustomersPage: (ids) => {
    dotyposState.customerPageCalls.push(ids.length);
    if (dotyposState.failNextCustomerPage) {
      dotyposState.failNextCustomerPage = false;
      return Effect.fail(
        new ExternalAPIError({ message: "Unavailable", statusCode: 503 })
      );
    }
    return seededCustomerReads(dotyposState.customers).getCustomersPage(ids);
  },
  getCustomers: ({ ids }) => {
    const selected = new Set<string>(ids);
    return Effect.succeed(
      dotyposState.customers.filter(
        ({ id }) => id !== undefined && selected.has(id)
      )
    );
  },
  listReservations: (options) => {
    dotyposState.reservationReads += 1;
    return seededReservationReads(dotyposState.reservations).listReservations(
      options
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
    };

    const reservationIdOf = (label: string) =>
      workspaceReservationIdSchema.make(`dry-run-workspace-${runId}-${label}`);

    const seedReservations = async (
      reservations: readonly SeedReservation[]
    ) => {
      const confirmedAt = ago({ hours: 24 * 60 });
      const rows = reservations.map((reservation) => {
        const id = reservationIdOf(reservation.label);
        reservationIds.push(id);
        const cancelled = reservation.workspaceCancelledAt !== undefined;
        return {
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(id),
          dotyposCustomerId: reservation.customer,
          dotyposReservationId: DotyposReservationIdSchema.make(
            `dry-run-reservation-${runId}-${reservation.label}`
          ),
          reservationState: cancelled
            ? ("cancelled" as const)
            : ("confirmed" as const),
          reservationConfirmedAt: confirmedAt,
          reservationCancelledAt: reservation.workspaceCancelledAt ?? null,
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
        };
      });
      for (let index = 0; index < rows.length; index += 500) {
        await query(
          db
            .insert(workspaceReservations)
            .values(rows.slice(index, index + 500))
        );
      }
      dotyposState.reservations.push(
        ...reservations.map(
          (reservation) =>
            ({
              id: DotyposReservationIdSchema.make(
                `dry-run-reservation-${runId}-${reservation.label}`
              ),
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
      expect(byEvent.get(e1!)?.sendAt?.equals(ago({ hours: 24 * 19 }))).toBe(
        true
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
          occurredAt: ago({ hours: 1, minutes: index }),
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
          row.triggerAt.equals(ago({ hours: 1, minutes: 1004 }))
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
        expect(units.length).toBeGreaterThanOrEqual(5);

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
        expect(dotyposState.customerPageCalls.every((ids) => ids <= 50)).toBe(
          true
        );
        const named = page.customers.find(
          ({ customerId }) => customerId === customers[0]
        );
        expect(named?.email).toBe(`${customers[0]}@deskohub.test`);
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
