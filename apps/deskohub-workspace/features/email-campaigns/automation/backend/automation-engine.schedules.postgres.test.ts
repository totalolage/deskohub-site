import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { type DotyposCustomerId, ExternalAPIError } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import {
  databaseInstant,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import { automationFlowFixture } from "./automation-lifecycle.test-utils";
import { scheduleDedupKey } from "./automation-schedule-fires";
import {
  comeBackOfferFlow,
  lapsedRegularsFilter,
  reviewRequestFlow,
} from "./automation-stories.test-utils";

const database = await connectWorkspacePostgresTestDatabase();

/** Tuesday 13 October 2026, 08:00 in Prague. */
const start = Temporal.Instant.from("2026-10-13T06:00:00Z");

/** Story 2's Mondays at 10:00 in Prague (summer time ends on 25 October). */
const mondays = [
  Temporal.Instant.from("2026-10-19T08:00:00Z"),
  Temporal.Instant.from("2026-10-26T09:00:00Z"),
  Temporal.Instant.from("2026-11-02T09:00:00Z"),
  Temporal.Instant.from("2026-11-09T09:00:00Z"),
] as const;
const [firstMonday, secondMonday, thirdMonday, fourthMonday] = mondays;

/** Story 2 moved to Tuesdays at 10:00 in Prague, as a second version. */
const tuesdayOfferFlow = automationFlowFixture({
  ...comeBackOfferFlow,
  trigger: {
    _tag: "Schedule",
    calendar: { hours: [10], weekdays: ["tuesday"] },
  },
});

const iso = (value: Date | string | null | undefined) =>
  databaseInstant(value)?.toString() ?? null;

const dotyposUnavailable = new ExternalAPIError({
  service: "dotypos",
  operation: "test",
  statusCode: 503,
  message: "Unavailable",
});

describe.skipIf(!database)(
  "the automation engine's schedules end to end",
  async () => {
    if (!database) return;
    const scenario = await makeAutomationEngineScenario({
      database,
      now: start,
    });
    const { fixtures, kit, read } = scenario;

    beforeEach(() => scenario.prepare(start));
    /**
     * Every schedule's pool is every consenting customer, so each test
     * archives its automations and withdraws its customers' consents.
     */
    afterEach(async () => {
      scenario.dotypos.onRequest(undefined);
      for (const campaignId of kit.campaignIds) {
        await scenario.lifecycle(
          (l) => l.archive(campaignId),
          start.add({ hours: 60 * 24 })
        );
      }
      await database.pool.query(
        "update customer_marketing_consents set withdrawn_at = $2 where dotypos_customer_id = any($1) and withdrawn_at is null",
        [fixtures.created.consents, start.toString()]
      );
      scenario.dotypos.setCustomers([]);
      scenario.dotypos.setReservations([]);
    });
    afterAll(() => scenario.cleanup());

    /** Story 2 activated at `at` with "Lapsed regulars" as its entry set. */
    const activateComeBackOffer = (
      input: { readonly audienceFilter?: typeof lapsedRegularsFilter } = {}
    ) =>
      kit.seedActive(comeBackOfferFlow, {
        at: start,
        audienceFilter: input.audienceFilter ?? lapsedRegularsFilter,
      });

    /** A visit of one day, 09:00–17:00 in Prague summer time. */
    const visit = (customer: DotyposCustomerId, label: string, day: string) =>
      fixtures.book({
        label,
        customer,
        startsAt: Temporal.Instant.from(`${day}T07:00:00Z`),
        endsAt: Temporal.Instant.from(`${day}T15:00:00Z`),
      });

    /** A consenting customer with two summer visits and none since: a lapsed regular. */
    const lapsedRegular = async (label: string) => {
      const customer = await fixtures.addCustomer(label);
      await visit(customer, `${label}-july`, "2026-07-06");
      await visit(customer, `${label}-august`, "2026-08-03");
      return customer;
    };

    const emailOf = (customer: DotyposCustomerId) =>
      testEmailAddress(customer.slice(-48));

    const mailedTo = (customer: DotyposCustomerId) =>
      scenario.resend.mailed().filter((to) => to === emailOf(customer)).length;

    const versionIds = async (campaignId: CampaignId) =>
      new Map(
        (
          await database.pool.query<{ id: string; version_number: number }>(
            "select id, version_number from email_campaign_automation_versions where campaign_id = $1",
            [campaignId]
          )
        ).rows.map((row) => [row.version_number, row.id])
      );

    const fireSummary = async (campaignId: CampaignId) =>
      (await read.fires(campaignId)).map((fire) => ({
        fireAt: iso(fire.fire_at),
        status: fire.status,
        versionId: fire.version_id,
        complete: fire.chunks_done === fire.chunks_total,
      }));

    const receiptSummary = async (campaignId: CampaignId) =>
      (await read.receipts(campaignId))
        .map((receipt) => ({
          key: receipt.dedup_key as string,
          disposition: receipt.disposition,
          versionId: receipt.version_id,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));

    const allEnded = async (...campaignIds: CampaignId[]) => {
      for (const campaignId of campaignIds) {
        const runs = await read.runs(campaignId);
        if (runs.length === 0 || runs.some((run) => run.status !== "ended")) {
          return false;
        }
      }
      return true;
    };

    const firesEntered = async (campaignId: CampaignId, count: number) => {
      const fires = await read.fires(campaignId);
      return (
        fires.length >= count &&
        fires.every((fire) => fire.status === "entered")
      );
    };

    describe("story 2: weekly come-back offer", () => {
      test("a schedule fires once per period and a lapsed regular gets the offer at each fire", async () => {
        const { campaignId } = await activateComeBackOffer();
        const versions = await versionIds(campaignId);
        const regular = await lapsedRegular("period-regular");
        const recent = await lapsedRegular("period-recent");
        await visit(recent, "period-recent-october", "2026-10-10");

        const progress = await scenario.runUntil({
          from: start,
          until: secondMonday.add({ hours: 1 }),
          sameInstant: true,
          settled: async () =>
            (await firesEntered(campaignId, 2)) &&
            (await read.runs(campaignId)).length === 2 &&
            (await allEnded(campaignId)),
        });
        expect(progress.settled).toBe(true);
        // Later minutes of the same period fire nothing more.
        for (const at of [
          secondMonday.add({ minutes: 1 }),
          secondMonday.add({ hours: 6 }),
          thirdMonday.subtract({ minutes: 1 }),
        ]) {
          await scenario.tick(at);
        }

        expect(await fireSummary(campaignId)).toEqual([
          {
            fireAt: firstMonday.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          },
          {
            fireAt: secondMonday.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          },
        ]);
        expect(iso((await read.automation(campaignId)).next_fire_at)).toBe(
          thirdMonday.toString()
        );
        const runs = await read.runs(campaignId);
        expect(
          runs.map((run) => ({
            customer: run.dotypos_customer_id,
            triggerKind: run.trigger_kind,
            triggerAt: iso(run.trigger_at),
            outcome: run.outcome,
          }))
        ).toEqual([
          {
            customer: regular,
            triggerKind: "schedule",
            triggerAt: firstMonday.toString(),
            outcome: "sent",
          },
          {
            customer: regular,
            triggerKind: "schedule",
            triggerAt: secondMonday.toString(),
            outcome: "condition-failed",
          },
        ]);
        // The chain fire → chunk → condition → deliver completes at the fire.
        expect(iso(runs[0].ended_at)).toBe(firstMonday.toString());
        expect(mailedTo(regular)).toBe(1);
        expect(mailedTo(recent)).toBe(0);
      });

      test("three missed fires replay in order, one entering at a time, each run triggered at its own fire", async () => {
        const { campaignId } = await activateComeBackOffer();
        const versions = await versionIds(campaignId);
        const early = await lapsedRegular("replay-early");
        // The engine was down from activation until Tuesday 3 November.
        const back = Temporal.Instant.from("2026-11-03T11:00:00Z");

        await scenario.plan(back);
        expect(await fireSummary(campaignId)).toEqual([
          {
            fireAt: firstMonday.toString(),
            status: "entering",
            versionId: versions.get(1),
            complete: false,
          },
        ]);
        // Each fire's pool is fixed when the fire is created: a customer who
        // consents meanwhile joins the next fire, not the entering one.
        const second = await lapsedRegular("replay-second");
        let third: DotyposCustomerId | undefined;
        const snapshots: string[][] = [[`${firstMonday} entering`]];
        for (
          let next = scenario.processNext(back);
          next !== undefined;
          next = scenario.processNext(back)
        ) {
          const delivery = await next;
          expect(delivery.outcome).not.toBe("redelivered");
          const fires = await read.fires(campaignId);
          const entering = fires.filter((fire) => fire.status === "entering");
          expect(entering.length).toBeLessThanOrEqual(1);
          // Every fire before the entering one has entered.
          expect(
            fires
              .filter((fire) => fire.status !== "entering")
              .every((fire) => fire.status === "entered")
          ).toBe(true);
          const snapshot = fires.map(
            (fire) => `${iso(fire.fire_at)} ${fire.status}`
          );
          if (snapshot.join() !== snapshots.at(-1)?.join()) {
            snapshots.push(snapshot);
          }
          if (
            third === undefined &&
            entering.length === 1 &&
            iso(entering[0].fire_at) === secondMonday.toString()
          ) {
            third = await lapsedRegular("replay-third");
          }
        }

        // Each fire's last chunk entered it and created the next one at once.
        expect(snapshots).toEqual([
          [`${firstMonday} entering`],
          [`${firstMonday} entered`, `${secondMonday} entering`],
          [
            `${firstMonday} entered`,
            `${secondMonday} entered`,
            `${thirdMonday} entering`,
          ],
          [
            `${firstMonday} entered`,
            `${secondMonday} entered`,
            `${thirdMonday} entered`,
          ],
        ]);
        expect(await fireSummary(campaignId)).toEqual(
          [firstMonday, secondMonday, thirdMonday].map((fireAt) => ({
            fireAt: fireAt.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          }))
        );
        expect(iso((await read.automation(campaignId)).next_fire_at)).toBe(
          fourthMonday.toString()
        );
        expect(third).toBeDefined();
        expect(
          (await receiptSummary(campaignId)).map(({ key, disposition }) => ({
            key,
            disposition,
          }))
        ).toEqual(
          [
            {
              key: scheduleDedupKey(firstMonday, early),
              disposition: "started",
            },
            {
              key: scheduleDedupKey(secondMonday, early),
              disposition: "already-active",
            },
            {
              key: scheduleDedupKey(thirdMonday, early),
              disposition: "already-active",
            },
            {
              key: scheduleDedupKey(secondMonday, second),
              disposition: "started",
            },
            {
              key: scheduleDedupKey(thirdMonday, second),
              disposition: "already-active",
            },
            {
              key: scheduleDedupKey(thirdMonday, third!),
              disposition: "started",
            },
          ].sort((a, b) => a.key.localeCompare(b.key))
        );
        const triggerAt = new Map(
          (await read.runs(campaignId)).map((run) => [
            run.dotypos_customer_id,
            iso(run.trigger_at),
          ])
        );
        expect(Object.fromEntries(triggerAt)).toEqual({
          [early]: firstMonday.toString(),
          [second]: secondMonday.toString(),
          [third!]: thirdMonday.toString(),
        });

        const progress = await scenario.runUntil({
          from: back,
          until: back.add({ hours: 1 }),
          sameInstant: true,
          settled: () => allEnded(campaignId),
        });
        expect(progress.settled).toBe(true);
        expect((await read.runs(campaignId)).map((run) => run.outcome)).toEqual(
          ["sent", "sent", "sent"]
        );
        for (const customer of [early, second, third!]) {
          expect(mailedTo(customer)).toBe(1);
        }
      });

      test("a customer sent the offer at one fire isn't offered it again at the next: condition-failed", async () => {
        const { campaignId } = await activateComeBackOffer();
        const regular = await lapsedRegular("again-regular");

        const first = await scenario.runUntil({
          from: start,
          until: firstMonday.add({ hours: 1 }),
          sameInstant: true,
          settled: () => allEnded(campaignId),
        });
        expect(first.settled).toBe(true);
        expect(mailedTo(regular)).toBe(1);
        // A lapsed regular who consents after the first fire gets the second one.
        const newcomer = await lapsedRegular("again-newcomer");

        const second = await scenario.runUntil({
          from: firstMonday.add({ hours: 1 }),
          until: secondMonday.add({ hours: 1 }),
          sameInstant: true,
          settled: async () =>
            (await read.runs(campaignId)).length === 3 &&
            (await allEnded(campaignId)),
        });
        expect(second.settled).toBe(true);

        const runs = await read.runs(campaignId);
        const again = runs.find(
          (run) =>
            run.dotypos_customer_id === regular &&
            iso(run.trigger_at) === secondMonday.toString()
        );
        expect(again).toMatchObject({
          status: "ended",
          outcome: "condition-failed",
        });
        const timeline = await read.timeline(again.id);
        expect(timeline.map((entry) => entry.kind)).toEqual([
          "started",
          "condition-failed",
        ]);
        expect(timeline.at(-1)).toMatchObject({
          step_id: "not-offered-recently",
          detail: { failedConditions: [0] },
        });
        expect(
          runs.find((run) => run.dotypos_customer_id === newcomer)
        ).toMatchObject({ outcome: "sent" });
        expect(mailedTo(regular)).toBe(1);
        expect(mailedTo(newcomer)).toBe(1);
      });

      test("a failing chunk blocks only its own automation's fires; another automation keeps firing", async () => {
        // Lapsed regulars reads visits; the other automation's entry set
        // (everyone) reads profiles only, so failing visit reads fails only
        // the first automation's chunks.
        const blocked = await activateComeBackOffer();
        const other = await kit.seedActive(comeBackOfferFlow, { at: start });
        const regular = await lapsedRegular("blocked-regular");
        scenario.dotypos.onRequest(({ method }) =>
          method === "listReservationsPage" || method === "listReservations"
            ? Effect.fail(dotyposUnavailable)
            : Effect.void
        );

        const firstWeek = await scenario.runUntil({
          from: start,
          until: firstMonday.add({ minutes: 30 }),
          sameInstant: true,
          settled: () => allEnded(other.campaignId),
        });
        expect(firstWeek.settled).toBe(true);
        const [chunk] = (await read.units(blocked.campaignId)).filter(
          (unit) => unit.kind === "fire-chunk"
        );
        expect(chunk).toMatchObject({ status: "enqueued" });
        expect(chunk.attempts).toBeGreaterThanOrEqual(1);
        expect(
          scenario.delayed().map(({ message }) => message.unitId)
        ).toContain(chunk.id);

        // A week on, the other automation fires again; the blocked one waits.
        const secondWeek = await scenario.runUntil({
          from: secondMonday,
          until: secondMonday.add({ minutes: 30 }),
          sameInstant: true,
          settled: async () =>
            (await read.runs(other.campaignId)).length === 2 &&
            (await allEnded(other.campaignId)),
        });
        expect(secondWeek.settled).toBe(true);
        expect(
          (await fireSummary(other.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([
          [firstMonday.toString(), "entered"],
          [secondMonday.toString(), "entered"],
        ]);
        expect(
          (await fireSummary(blocked.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([[firstMonday.toString(), "entering"]]);
        expect(
          iso((await read.automation(blocked.campaignId)).next_fire_at)
        ).toBe(firstMonday.toString());
        expect(await read.runs(blocked.campaignId)).toEqual([]);
        expect(mailedTo(regular)).toBe(1);

        // Once visits read again, the blocked fire enters and the missed one follows.
        scenario.dotypos.onRequest(undefined);
        const recovered = await scenario.runUntil({
          from: secondMonday.add({ minutes: 30 }),
          until: secondMonday.add({ hours: 2 }),
          sameInstant: true,
          settled: async () =>
            (await firesEntered(blocked.campaignId, 2)) &&
            (await allEnded(blocked.campaignId)),
        });
        expect(recovered.settled).toBe(true);
        expect(
          (await fireSummary(blocked.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([
          [firstMonday.toString(), "entered"],
          [secondMonday.toString(), "entered"],
        ]);
        const [run] = await read.runs(blocked.campaignId);
        expect(iso(run.trigger_at)).toBe(firstMonday.toString());
        expect(run.outcome).toBe("sent");
        expect(mailedTo(regular)).toBe(2);
      });

      test("a version activated mid-backlog: fires before its activation use v1, later ones v2's calendar and version", async () => {
        const { campaignId } = await activateComeBackOffer();
        const regular = await lapsedRegular("midway-regular");
        // Wednesday 28 October, with the 19 and 26 October fires still due.
        const activatedAt = Temporal.Instant.from("2026-10-28T11:00:00Z");
        await kit.run(
          kit.lifecycle((l) =>
            l.updateFlow({ campaignId, flow: tuesdayOfferFlow })
          ),
          activatedAt
        );
        const previewId = await kit.seedPreview(campaignId, {
          status: "completed",
        });
        await kit.run(
          kit.lifecycle((l) =>
            l.activate({ campaignId, previewId, activatedBy: null })
          ),
          activatedAt
        );
        const versions = await versionIds(campaignId);
        expect(versions.size).toBe(2);
        expect(iso((await read.automation(campaignId)).next_fire_at)).toBe(
          firstMonday.toString()
        );

        const firstTuesday = Temporal.Instant.from("2026-11-03T09:00:00Z");
        const back = Temporal.Instant.from("2026-11-04T11:00:00Z");
        const progress = await scenario.runUntil({
          from: back,
          until: back.add({ hours: 1 }),
          sameInstant: true,
          settled: async () =>
            (await firesEntered(campaignId, 3)) && (await allEnded(campaignId)),
        });
        expect(progress.settled).toBe(true);

        // Monday 2 November never fires: v2 replaced v1's calendar on 28 October.
        expect(await fireSummary(campaignId)).toEqual([
          {
            fireAt: firstMonday.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          },
          {
            fireAt: secondMonday.toString(),
            status: "entered",
            versionId: versions.get(1),
            complete: true,
          },
          {
            fireAt: firstTuesday.toString(),
            status: "entered",
            versionId: versions.get(2),
            complete: true,
          },
        ]);
        expect(iso((await read.automation(campaignId)).next_fire_at)).toBe(
          "2026-11-10T09:00:00Z"
        );
        expect(await receiptSummary(campaignId)).toEqual([
          {
            key: scheduleDedupKey(firstMonday, regular),
            disposition: "started",
            versionId: versions.get(1),
          },
          {
            key: scheduleDedupKey(secondMonday, regular),
            disposition: "already-active",
            versionId: versions.get(1),
          },
          {
            key: scheduleDedupKey(firstTuesday, regular),
            disposition: "already-active",
            versionId: versions.get(2),
          },
        ]);
        const [run] = await read.runs(campaignId);
        expect(run).toMatchObject({
          version_id: versions.get(1),
          outcome: "sent",
        });
        expect(iso(run.trigger_at)).toBe(firstMonday.toString());
      });
    });

    describe("Dotypos down", () => {
      test("units are redelivered every 60 s; after 24 h a condition run ends failed / evaluation-unavailable and an event gets a failed receipt, while a fire waits and enters once Dotypos recovers", async () => {
        const review = await kit.seedActive(reviewRequestFlow, { at: start });
        const offer = await activateComeBackOffer();
        const regular = await lapsedRegular("outage-regular");
        const waiting = await fixtures.addCustomer("outage-waiting");
        const waitingVisit = await visit(
          waiting,
          "outage-waiting-visit",
          "2026-10-12"
        );
        const late = await fixtures.addCustomer("outage-late");
        const lateVisit = await visit(late, "outage-late-visit", "2026-10-12");

        // Monday 19 October, an hour before the offer fires: a finished
        // visit enters the review request and reaches its condition.
        const before = firstMonday.subtract({ hours: 1 });
        await fixtures.recordEvent({
          kind: "reservation-finished",
          customer: waiting,
          reservationId: waitingVisit,
          occurredAt: before,
          recordedAt: before,
        });
        await scenario.tick(before);
        const [conditionRun] = await read.runs(review.campaignId);
        expect(conditionRun).toMatchObject({
          status: "active",
          step_id: "second-visit-within-a-month",
          phase: "ready",
        });

        // Dotypos goes down; a second finished visit is recorded.
        scenario.dotypos.onRequest(() => Effect.fail(dotyposUnavailable));
        const down = before.add({ minutes: 1 });
        const lateEvent = await fixtures.recordEvent({
          kind: "reservation-finished",
          customer: late,
          reservationId: lateVisit,
          occurredAt: down,
          recordedAt: down,
        });
        const failing = await scenario.tick(down);
        const failedKinds = async () =>
          new Map(
            (await read.units())
              .filter((unit) =>
                failing.deliveries.some(
                  (delivery) =>
                    delivery.unitId === unit.id &&
                    delivery.outcome === "redelivered"
                )
              )
              .map((unit) => [unit.kind as string, unit])
          );
        const failed = await failedKinds();
        expect([...failed.keys()]).toEqual(
          expect.arrayContaining(["intake", "condition"])
        );
        for (const unit of failed.values()) {
          expect(unit).toMatchObject({ status: "enqueued", attempts: 1 });
        }
        const failedIds = [...failed.values()].map((unit) => unit.id);
        expect(
          scenario
            .delayed()
            .filter(({ message }) => failedIds.includes(message.unitId))
            .map(({ availableAt }) => availableAt.toString())
        ).toEqual(failedIds.map(() => down.add({ seconds: 60 }).toString()));

        // Not redelivered before 60 s, then redelivered and failing again.
        const early = await scenario.tick(down.add({ seconds: 59 }));
        expect(
          early.deliveries.filter((delivery) =>
            failedIds.includes(delivery.unitId)
          )
        ).toEqual([]);
        const retried = await scenario.tick(down.add({ seconds: 60 }));
        for (const unit of failed.values()) {
          expect(retried.deliveries).toContainEqual({
            unitId: unit.id,
            outcome: "redelivered",
          });
        }

        // The offer falls due and its chunk fails too.
        await scenario.tick(firstMonday);
        expect(
          (await fireSummary(offer.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([[firstMonday.toString(), "entering"]]);

        // 24 hours on, the condition run and the event give up; the fire waits.
        const dayLater = down.add({ hours: 24, minutes: 1 });
        await scenario.tick(dayLater);
        const [expiredRun] = await read.runs(review.campaignId);
        expect(expiredRun).toMatchObject({
          id: conditionRun.id,
          status: "ended",
          outcome: "failed",
          outcome_reason: "evaluation-unavailable",
        });
        expect(
          (await read.timeline(conditionRun.id)).map((entry) => entry.kind)
        ).toEqual(["started", "failed"]);
        expect(
          (await read.receipts(review.campaignId)).map((receipt) => ({
            customer: receipt.dotypos_customer_id,
            event: receipt.customer_event_id,
            disposition: receipt.disposition,
          }))
        ).toContainEqual({
          customer: late,
          event: lateEvent,
          disposition: "failed",
        });
        const [lateEventRow] = await read.events([lateEvent]);
        expect(lateEventRow.automation_processed_at).not.toBeNull();
        expect(await read.runs(review.campaignId)).toHaveLength(1);

        // Fires never expire: a week on, the first is still entering and the
        // second waits behind it.
        await scenario.tick(secondMonday);
        expect(
          (await fireSummary(offer.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([[firstMonday.toString(), "entering"]]);
        expect(
          iso((await read.automation(offer.campaignId)).next_fire_at)
        ).toBe(firstMonday.toString());
        const [chunk] = (await read.units(offer.campaignId)).filter(
          (unit) => unit.kind === "fire-chunk"
        );
        expect(chunk.status).toBe("enqueued");
        expect(chunk.attempts).toBeGreaterThanOrEqual(3);
        expect(await read.runs(offer.campaignId)).toEqual([]);

        // Dotypos recovers: the first fire enters and the second follows.
        scenario.dotypos.onRequest(undefined);
        const recovered = await scenario.runUntil({
          from: secondMonday.add({ minutes: 1 }),
          until: secondMonday.add({ hours: 1 }),
          sameInstant: true,
          settled: async () =>
            (await firesEntered(offer.campaignId, 2)) &&
            (await allEnded(offer.campaignId)),
        });
        expect(recovered.settled).toBe(true);
        expect(
          (await fireSummary(offer.campaignId)).map(({ fireAt, status }) => [
            fireAt,
            status,
          ])
        ).toEqual([
          [firstMonday.toString(), "entered"],
          [secondMonday.toString(), "entered"],
        ]);
        const [offered] = await read.runs(offer.campaignId);
        expect(offered).toMatchObject({
          dotypos_customer_id: regular,
          outcome: "sent",
        });
        expect(iso(offered.trigger_at)).toBe(firstMonday.toString());
        expect(mailedTo(regular)).toBe(1);
      });
    });
  }
);
