import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Option } from "effect";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import { evaluateStep } from "../automation-step-evaluation";
import { makeAutomationDryRunner } from "./automation-dry-run.test-utils";
import {
  type AutomationEngineScenario,
  databaseInstant,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import { automationFlowFixture } from "./automation-lifecycle.test-utils";

const returnOfferFlow = automationFlowFixture({
  trigger: { _tag: "ReservationFinished" },
  steps: [
    {
      _tag: "Wait",
      id: "one-hour",
      wait: { _tag: "Duration", count: 1, unit: "hour" },
    },
    {
      _tag: "Wait",
      id: "ten-oclock",
      wait: { _tag: "Calendar", expression: { hours: [10], minutes: [0] } },
    },
    { _tag: "Send", id: "send" },
  ],
});

// The planner reads whole tables; every case cleans its own synthetic data.
const database = await createWorkspacePostgresSuiteDatabase("return_waits");
afterAll(() => database?.close());

describe.skipIf(!database)(
  "ordinary return-offer waits, live and dry run",
  () => {
    if (!database) return;
    const instant = (value: string) => Temporal.Instant.from(value);
    const iso = (value: Date | string | null | undefined) =>
      databaseInstant(value)?.toString() ?? null;
    let scenario: AutomationEngineScenario;

    beforeEach(async () => {
      scenario = await makeAutomationEngineScenario({
        database,
        now: instant("2026-01-01T00:00:00Z"),
      });
    });
    afterEach(() => scenario.cleanup());

    const runOf = async (campaignId: CampaignId) => {
      const runs = await scenario.read.runs(campaignId);
      expect(runs).toHaveLength(1);
      return runs[0]!;
    };

    /** Run the real preview service and queued preview handler on the same facts. */
    const begin = async (
      endedAt: Temporal.Instant,
      // Replay's history window excludes asOf, so preview after the event.
      processedAt = endedAt.add({ seconds: 1 })
    ) => {
      const start = endedAt.subtract({ hours: 1 });
      await scenario.prepare(start);
      const active = await scenario.kit.seedActive(returnOfferFlow, {
        at: start,
      });
      const customer = await scenario.fixtures.addCustomer("return-waits");
      const reservationId = await scenario.fixtures.book({
        label: "finished-visit",
        customer,
        startsAt: endedAt.subtract({ hours: 8 }),
        endsAt: endedAt,
      });
      const eventId = await scenario.fixtures.recordEvent({
        kind: "reservation-finished",
        customer,
        occurredAt: endedAt,
        reservationId,
      });
      // Replace the activation kit's preview stand-in with a real replay.
      await database.pool.query(
        "update email_campaign_automation_previews set status = 'superseded' where id = $1",
        [active.previewId]
      );
      const dryRunner = makeAutomationDryRunner({
        database,
        dotypos: scenario.dotypos.layer,
      });
      const preview = await dryRunner.start(active.campaignId, processedAt);
      expect(preview.kind).toBe("replay");
      const progress = await scenario.runUntil({
        from: processedAt,
        until: processedAt,
        sameInstant: true,
        settled: async () => {
          const { rows } = await database.pool.query<{ status: string }>(
            "select status from email_campaign_automation_previews where id = $1",
            [preview.previewId]
          );
          return rows[0]?.status === "completed";
        },
      });
      expect(progress.settled).toBe(true);
      const { rows } = await database.pool.query<{
        outcome: string;
        step_id: string;
        send_at: Date | string | null;
      }>(
        "select outcome, step_id, send_at from email_campaign_automation_preview_rows where preview_id = $1 and customer_event_id = $2",
        [preview.previewId, eventId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: "would-send", step_id: "send" });
      return {
        campaignId: active.campaignId,
        customer,
        reservationId,
        previewId: preview.previewId,
        previewSendAt: iso(rows[0]!.send_at),
      };
    };

    const expectWaiting = async (
      campaignId: CampaignId,
      stepId: string,
      dueAt: Temporal.Instant
    ) => {
      const run = await runOf(campaignId);
      expect(run).toMatchObject({
        status: "active",
        phase: "waiting",
        step_id: stepId,
      });
      expect(iso(run.due_at)).toBe(dueAt.toString());
      expect(scenario.resend.mailed()).toEqual([]);
      return run;
    };

    const expectSent = async (
      active: Awaited<ReturnType<typeof begin>>,
      at: Temporal.Instant
    ) => {
      const run = await runOf(active.campaignId);
      expect(run).toMatchObject({
        status: "ended",
        outcome: "sent",
        step_id: "send",
        trigger_kind: "reservation-finished",
        trigger_reservation_id: active.reservationId,
      });
      expect(iso(run.step_entered_at)).toBe(at.toString());
      expect(iso(run.ended_at)).toBe(at.toString());
      expect(scenario.resend.mailed()).toEqual([
        testEmailAddress(active.customer.slice(-48)),
      ]);
      return run;
    };

    test.each([
      {
        name: "one hour finishes just before 10:00",
        endedAt: "2026-02-10T07:45:00Z",
        entryAt: "2026-02-10T07:45:01Z",
        durationDueAt: "2026-02-10T08:45:00Z",
        sendAt: "2026-02-10T09:00:00Z",
      },
      {
        name: "one hour finishes exactly at 10:00",
        endedAt: "2026-02-10T08:00:00Z",
        entryAt: "2026-02-10T08:00:01Z",
        durationDueAt: "2026-02-10T09:00:00Z",
        sendAt: "2026-02-10T09:00:00Z",
      },
      {
        name: "seconds after the intake tick moves the offer to tomorrow",
        endedAt: "2026-02-10T08:00:01Z",
        entryAt: "2026-02-10T08:15:00Z",
        beforeEntryAt: "2026-02-10T08:14:59Z",
        durationDueAt: "2026-02-10T09:15:00Z",
        sendAt: "2026-02-11T09:00:00Z",
      },
      {
        name: "an hour crossing Prague's spring clock change",
        endedAt: "2026-03-29T00:30:00Z",
        entryAt: "2026-03-29T00:30:01Z",
        durationDueAt: "2026-03-29T01:30:00Z",
        sendAt: "2026-03-29T08:00:00Z",
      },
      {
        name: "an hour crossing Prague's autumn clock change",
        endedAt: "2026-10-25T00:30:00Z",
        entryAt: "2026-10-25T00:30:01Z",
        durationDueAt: "2026-10-25T01:30:00Z",
        sendAt: "2026-10-25T09:00:00Z",
      },
      {
        name: "late intake anchors the hour to its entry tick despite queue jitter",
        endedAt: "2026-02-10T07:45:00Z",
        processedAt: "2026-02-10T08:00:37Z",
        entryAt: "2026-02-10T08:00:37Z",
        durationDueAt: "2026-02-10T09:00:00Z",
        sendAt: "2026-02-10T09:00:00Z",
      },
    ])("$name", async (example) => {
      const endedAt = instant(example.endedAt);
      const entryAt = instant(example.entryAt);
      const durationDueAt = instant(example.durationDueAt);
      const sendAt = instant(example.sendAt);
      const active = await begin(
        endedAt,
        example.processedAt ? instant(example.processedAt) : undefined
      );
      expect(active.previewSendAt).toBe(sendAt.toString());
      if (example.beforeEntryAt) {
        await scenario.tick(instant(example.beforeEntryAt));
        expect(await scenario.read.runs(active.campaignId)).toEqual([]);
      }
      await scenario.tick(entryAt);
      const entered = await expectWaiting(
        active.campaignId,
        "one-hour",
        durationDueAt
      );
      expect(iso(entered.trigger_at)).toBe(endedAt.toString());
      expect(iso(entered.step_entered_at)).toBe(entryAt.toString());
      await scenario.tick(durationDueAt.subtract({ seconds: 1 }));
      await expectWaiting(active.campaignId, "one-hour", durationDueAt);
      await scenario.tick(durationDueAt);
      if (Temporal.Instant.compare(sendAt, durationDueAt) > 0) {
        await expectWaiting(active.campaignId, "ten-oclock", sendAt);
        await scenario.tick(sendAt.subtract({ seconds: 1 }));
        await expectWaiting(active.campaignId, "ten-oclock", sendAt);
        await scenario.tick(sendAt);
      }
      const sent = await expectSent(active, sendAt);
      expect(iso(sent.step_entered_at)).toBe(active.previewSendAt);
    });

    test("a due Calendar wait still sends when processed late without a pause", async () => {
      const active = await begin(instant("2026-02-10T07:30:00Z"));
      const calendarEntryAt = instant("2026-02-10T08:30:00Z");
      const dueAt = instant("2026-02-10T09:00:00Z");
      await scenario.tick(calendarEntryAt);
      await expectWaiting(active.campaignId, "ten-oclock", dueAt);
      const lateAt = instant("2026-02-10T09:45:37Z");
      // Replay models on-time processing; the shared evaluator also handles lateness.
      expect(active.previewSendAt).toBe(dueAt.toString());
      expect(
        evaluateStep({
          step: returnOfferFlow.steps[1]!,
          phase: "waiting",
          at: lateAt,
          stepEnteredAt: calendarEntryAt,
          dueAt: Option.some(dueAt),
          resumedAt: Option.none(),
          condition: Option.none(),
        })
      ).toMatchObject({ _tag: "Advance" });
      await scenario.tick(lateAt);
      await expectSent(active, lateAt);
    });

    test("a Duration wait missed during a pause can still reach today's 10:00", async () => {
      const active = await begin(instant("2026-02-10T07:30:00Z"));
      const durationDueAt = instant("2026-02-10T08:30:00Z");
      const sendAt = instant("2026-02-10T09:00:00Z");
      await scenario.lifecycle(
        (lifecycle) => lifecycle.pause(active.campaignId),
        instant("2026-02-10T08:00:00Z")
      );
      await scenario.tick(durationDueAt);
      await expectWaiting(active.campaignId, "one-hour", durationDueAt);
      const resumedAt = instant("2026-02-10T08:45:00Z");
      await scenario.lifecycle(
        (lifecycle) => lifecycle.resume(active.campaignId),
        resumedAt
      );
      await scenario.tick(resumedAt);
      await expectWaiting(active.campaignId, "ten-oclock", sendAt);
      await scenario.tick(sendAt);
      const sent = await expectSent(active, sendAt);
      expect(iso(sent.step_entered_at)).toBe(active.previewSendAt);
    });

    test("a pause missing the exact 10:00 minute reschedules the Calendar wait", async () => {
      const active = await begin(instant("2026-02-10T07:30:00Z"));
      const calendarEntryAt = instant("2026-02-10T08:30:00Z");
      const dueAt = instant("2026-02-10T09:00:00Z");
      await scenario.tick(calendarEntryAt);
      await expectWaiting(active.campaignId, "ten-oclock", dueAt);
      await scenario.lifecycle(
        (lifecycle) => lifecycle.pause(active.campaignId),
        instant("2026-02-10T08:45:00Z")
      );
      await scenario.tick(dueAt);
      await expectWaiting(active.campaignId, "ten-oclock", dueAt);
      const resumedAt = instant("2026-02-10T09:01:00Z");
      const nextDay = instant("2026-02-11T09:00:00Z");
      await scenario.lifecycle(
        (lifecycle) => lifecycle.resume(active.campaignId),
        resumedAt
      );
      // Dry runs do not replay pauses. Compare the resumed live state with their evaluator.
      expect(active.previewSendAt).toBe(dueAt.toString());
      const evaluated = evaluateStep({
        step: returnOfferFlow.steps[1]!,
        phase: "waiting",
        at: resumedAt,
        stepEnteredAt: calendarEntryAt,
        dueAt: Option.some(dueAt),
        resumedAt: Option.some(resumedAt),
        condition: Option.none(),
      });
      expect(evaluated._tag).toBe("Wait");
      expect(evaluated._tag === "Wait" && evaluated.dueAt.toString()).toBe(
        nextDay.toString()
      );
      await scenario.tick(resumedAt);
      await expectWaiting(active.campaignId, "ten-oclock", nextDay);
      await scenario.tick(nextDay.subtract({ seconds: 1 }));
      await expectWaiting(active.campaignId, "ten-oclock", nextDay);
      await scenario.tick(nextDay);
      await expectSent(active, nextDay);
    });
  }
);
