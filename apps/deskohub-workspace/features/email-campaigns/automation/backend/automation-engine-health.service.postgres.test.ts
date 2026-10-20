import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import {
  customerEvents,
  emailCampaignAutomationScheduleFires,
  emailCampaignAutomations,
  type ReservationState,
  emailCampaignAutomationWorkUnits as units,
  workspaceReservations,
} from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomationVersion,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import type { CampaignId } from "@/features/email-campaigns/campaign-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  createWorkspacePostgresSuiteDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { seedAutomationUnit } from "./automation-engine.test-utils";
import { AutomationEngineHealth } from "./automation-engine-health.service";

/**
 * The health report counts every unit and sweep cursor, so the suite runs
 * on a database of its own.
 */
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "automation_engine_health"
);
afterAll(() => testDatabase?.close());

const suite = crypto.randomUUID().slice(0, 8);
const now = Temporal.Instant.from("2026-10-19T12:00:00Z");
const ago = (duration: Temporal.DurationLike) => now.subtract(duration);
const at = (time: string) => Temporal.Instant.from(`2026-10-19T${time}Z`);

describe.skipIf(!testDatabase)(
  "automation engine health on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db, pool, layer } = testDatabase;
    const campaignIds: CampaignId[] = [];
    const reservationIds: WorkspaceReservationId[] = [];

    const health = () =>
      Effect.runPromise(
        TestClock.setTime(now.epochMilliseconds).pipe(
          Effect.andThen(
            Effect.flatMap(AutomationEngineHealth, (engine) => engine.get)
          ),
          Effect.provide(AutomationEngineHealth.Default),
          Effect.provide(layer),
          Effect.provide(TestClock.layer())
        )
      );

    const setHeartbeats = async (input: {
      readonly lastPlannedAt: Temporal.Instant;
      readonly sweptUntil: Temporal.Instant;
    }) => {
      await pool.query(
        "update email_campaign_automation_engine set last_planned_at = $1 where id = 1",
        [input.lastPlannedAt.toString()]
      );
      await pool.query("update customer_event_sweeps set swept_until = $1", [
        input.sweptUntil.toString(),
      ]);
    };

    /** An automation with one published schedule and its pending fire. */
    const schedule = async (input: {
      readonly minutes: readonly number[];
      readonly nextFireAt: Temporal.Instant;
    }) => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "marketing",
      });
      campaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
        trigger: {
          _tag: "Schedule",
          calendar: { minutes: [...input.minutes] },
        },
        activatedAt: at("08:00:00"),
      });
      await Effect.runPromise(
        db
          .insert(emailCampaignAutomations)
          .values({ campaignId, nextFireAt: input.nextFireAt })
      );
      const fire = (fire: {
        readonly fireAt: Temporal.Instant;
        readonly createdAt: Temporal.Instant;
        readonly settledAt?: Temporal.Instant;
        readonly chunksDone: number;
        readonly chunksTotal: number;
      }) =>
        Effect.runPromise(
          db.insert(emailCampaignAutomationScheduleFires).values({
            campaignId,
            versionId,
            status: fire.settledAt === undefined ? "entering" : "entered",
            ...fire,
          })
        );
      return { campaignId, fire };
    };

    /** A unit seeded in `status`, then given the engine's bookkeeping. */
    const unit = async (
      input: Parameters<typeof seedAutomationUnit>[1] & {
        readonly attempts?: number;
        readonly firstAttemptAt?: Temporal.Instant;
        readonly lastErrorCode?: string;
        readonly deadlineMisses?: number;
      }
    ) => {
      const {
        attempts,
        firstAttemptAt,
        lastErrorCode,
        deadlineMisses,
        ...seed
      } = input;
      const seeded = await Effect.runPromise(seedAutomationUnit(db, seed));
      await Effect.runPromise(
        db
          .update(units)
          .set({
            attempts: attempts ?? 0,
            firstAttemptAt: firstAttemptAt ?? null,
            lastErrorCode: lastErrorCode ?? null,
            deadlineMisses: deadlineMisses ?? 0,
          })
          .where(eq(units.id, seeded.id))
      );
    };

    const reservations = async (
      customer: string,
      states: readonly ReservationState[]
    ) => {
      const confirmedAt = at("09:00:00");
      const rows = states.map((reservationState, index) => {
        const id = workspaceReservationIdSchema.make(
          `engine-health-${suite}-${customer}-${index}`
        );
        reservationIds.push(id);
        return {
          id,
          authorAccountId: fixtureReservationAuthorId,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(id),
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `engine-health-${suite}-${customer}`
          ),
          dotyposReservationId: DotyposReservationIdSchema.make(id),
          reservationState,
          reservationConfirmedAt: confirmedAt,
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
      });
      await Effect.runPromise(db.insert(workspaceReservations).values(rows));
      return rows.map(({ id }) => id);
    };

    beforeEach(async () => {
      await pool.query("delete from email_campaign_automation_work_units");
    });

    afterAll(async () => {
      await pool.query("delete from email_campaign_automation_work_units");
      await Effect.runPromise(
        db
          .delete(customerEvents)
          .where(inArray(customerEvents.workspaceReservationId, reservationIds))
      );
      await Effect.runPromise(
        db
          .delete(workspaceReservations)
          .where(inArray(workspaceReservations.id, reservationIds))
      );
      await Effect.runPromise(
        db
          .delete(emailCampaignAutomationScheduleFires)
          .where(
            inArray(
              emailCampaignAutomationScheduleFires.campaignId,
              campaignIds
            )
          )
      );
      await deleteAutomatedCampaigns(db, campaignIds);
    });

    test("reports every field of a keeping-pace engine without warnings", async () => {
      // One missed tick isn't stale.
      await setHeartbeats({
        lastPlannedAt: ago({ minutes: 16 }),
        sweptUntil: ago({ minutes: 3 }),
      });
      const hourly = await schedule({
        minutes: [0],
        nextFireAt: at("13:00:00"),
      });
      await hourly.fire({
        fireAt: at("11:00:00"),
        createdAt: at("11:00:30"),
        settledAt: at("11:10:30"),
        chunksDone: 4,
        chunksTotal: 4,
      });
      const halfHourly = await schedule({
        minutes: [0, 30],
        nextFireAt: at("12:30:00"),
      });
      await halfHourly.fire({
        fireAt: at("11:30:00"),
        createdAt: at("11:30:00"),
        settledAt: at("11:40:00"),
        chunksDone: 3,
        chunksTotal: 3,
      });
      await halfHourly.fire({
        fireAt: at("11:55:00"),
        createdAt: at("11:55:00"),
        chunksDone: 2,
        chunksTotal: 5,
      });

      const recently = ago({ minutes: 30 });
      for (const seconds of [10, 20]) {
        await unit({
          kind: "intake",
          status: "done",
          attempts: 1,
          firstAttemptAt: recently,
          settledAt: recently.add({ seconds }),
        });
      }
      // A retried unit and one settled before the window aren't samples.
      await unit({
        kind: "intake",
        status: "done",
        attempts: 2,
        firstAttemptAt: recently,
        settledAt: recently.add({ seconds: 500 }),
      });
      await unit({
        kind: "intake",
        status: "done",
        attempts: 1,
        firstAttemptAt: ago({ hours: 2 }),
        settledAt: ago({ hours: 2 }).add({ seconds: 500 }),
      });
      for (const _ of [1, 2]) {
        await unit({
          kind: "condition",
          status: "enqueued",
          enqueuedAt: ago({ minutes: 1 }),
          lastErrorCode: "dotypos-rate-limited",
          attempts: 1,
        });
      }
      await unit({
        kind: "deliver",
        status: "enqueued",
        enqueuedAt: ago({ minutes: 1 }),
      });
      await unit({
        kind: "fire-chunk",
        status: "claimed",
        claimId: crypto.randomUUID(),
        claimExpiresAt: now.add({ minutes: 4 }),
        deadlineMisses: 2,
      });
      await unit({
        kind: "preview",
        status: "planned",
        createdAt: ago({ minutes: 1 }),
      });

      const baseline = await health();
      await reservations("largest", [
        ...Array.from(
          { length: (baseline.largestCustomerBookedCount ?? 0) + 2 },
          () => "confirmed" as const
        ),
        "cancelled",
      ]);
      const report = await health();

      expect(report).toMatchObject({
        lastPlannedAt: ago({ minutes: 16 }).toString(),
        sweepLagSeconds: 180,
        unitDurations: [
          { kind: "intake", samples: 2, meanSeconds: 15, maxSeconds: 20 },
        ],
        units: [
          { kind: "condition", status: "enqueued", count: 2 },
          { kind: "deliver", status: "enqueued", count: 1 },
          { kind: "fire-chunk", status: "claimed", count: 1 },
          { kind: "intake", status: "done", count: 4 },
          { kind: "preview", status: "planned", count: 1 },
        ],
        oldestPlannedUnitAt: ago({ minutes: 1 }).toString(),
        retryingUnits: [
          { kind: "condition", errorCode: "dotypos-rate-limited", count: 2 },
        ],
        deadlineMisses: 2,
        largestCustomerBookedCount:
          (baseline.largestCustomerBookedCount ?? 0) + 2,
        soloThreshold: 350,
        warnings: [],
      });
      const automation = (campaignId: CampaignId) =>
        report.automations.find((entry) => entry.campaignId === campaignId);
      expect(automation(hourly.campaignId)).toEqual({
        campaignId: hourly.campaignId,
        scheduleLagSeconds: 0,
        enteringFire: null,
        lastFire: {
          fireAt: at("11:00:00").toString(),
          durationSeconds: 600,
          intervalSeconds: 3600,
          fallingBehind: false,
        },
      });
      expect(automation(halfHourly.campaignId)).toEqual({
        campaignId: halfHourly.campaignId,
        scheduleLagSeconds: 300,
        enteringFire: {
          fireAt: at("11:55:00").toString(),
          chunksDone: 2,
          chunksTotal: 5,
        },
        lastFire: {
          fireAt: at("11:30:00").toString(),
          durationSeconds: 600,
          intervalSeconds: 1800,
          fallingBehind: false,
        },
      });
    });

    test("warns about a stale planner, backlogs and a schedule falling behind", async () => {
      await setHeartbeats({
        lastPlannedAt: ago({ minutes: 31 }),
        sweptUntil: ago({ minutes: 31 }),
      });
      const [reservationId] = await reservations("backlog", ["confirmed"]);
      await Effect.runPromise(
        db.insert(customerEvents).values({
          kind: "reservation-booked",
          occurredAt: ago({ minutes: 31 }),
          recordedAt: ago({ minutes: 31 }),
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `engine-health-${suite}-backlog`
          ),
          workspaceReservationId: reservationId!,
        })
      );
      await unit({
        kind: "preview",
        status: "planned",
        createdAt: ago({ minutes: 31 }),
      });
      const everyTenMinutes = await schedule({
        minutes: [0, 10, 20, 30, 40, 50],
        nextFireAt: at("11:10:00"),
      });
      await everyTenMinutes.fire({
        fireAt: at("11:00:00"),
        createdAt: at("11:00:00"),
        settledAt: at("11:15:00"),
        chunksDone: 20,
        chunksTotal: 20,
      });

      const report = await health();

      expect(report.oldestUnprocessedEventAt).toBe(
        ago({ minutes: 31 }).toString()
      );
      expect(report.sweepLagSeconds).toBe(31 * 60);
      expect(
        report.automations.find(
          ({ campaignId }) => campaignId === everyTenMinutes.campaignId
        )
      ).toEqual({
        campaignId: everyTenMinutes.campaignId,
        scheduleLagSeconds: 50 * 60,
        enteringFire: null,
        lastFire: {
          fireAt: at("11:00:00").toString(),
          durationSeconds: 900,
          intervalSeconds: 600,
          fallingBehind: true,
        },
      });
      expect(report.warnings).toEqual([
        "planner-stale",
        "sweep-lagging",
        "event-backlog",
        "unit-backlog",
        "schedule-lagging",
        "falling-behind",
      ]);
    });
  }
);
