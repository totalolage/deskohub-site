import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import {
  databaseInstant,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import { automationFlowFixture } from "./automation-lifecycle.test-utils";

const database = await connectWorkspacePostgresTestDatabase();

/** Tuesday 13 October 2026, 08:00 in Prague. */
const start = Temporal.Instant.from("2026-10-13T06:00:00Z");

/** Story 1 (§2.4): a review request after a second visit within a month. */
const reviewRequestFlow = automationFlowFixture({
  trigger: { _tag: "ReservationFinished" },
  steps: [
    {
      _tag: "Condition",
      id: "second-visit-within-a-month",
      filter: {
        _tag: "Group",
        operator: "and",
        filters: [
          {
            attribute: "reservationCount",
            _tag: "Condition",
            params: {
              dateBasis: "visit",
              period: {
                _tag: "TriggerWindow",
                side: "before",
                count: 1,
                unit: "month",
              },
            },
            operator: "eq",
            value: 2,
          },
          {
            attribute: "firstVisit",
            _tag: "Condition",
            operator: "in",
            value: {
              _tag: "TriggerWindow",
              side: "before",
              count: 1,
              unit: "month",
            },
          },
          {
            attribute: "campaignEmailCount",
            _tag: "Condition",
            params: {
              purpose: "any",
              period: { _tag: "AnyTime" },
              campaign: { _tag: "This" },
            },
            operator: "eq",
            value: 0,
          },
        ],
      },
    },
    {
      _tag: "Wait",
      id: "settle",
      wait: { _tag: "Duration", count: 2, unit: "hour" },
    },
    {
      _tag: "Wait",
      id: "ten-oclock",
      wait: { _tag: "Calendar", expression: { hours: [10] } },
    },
    { _tag: "Send", id: "send" },
  ],
});

const iso = (value: Date | string | null | undefined) =>
  databaseInstant(value)?.toString() ?? null;

describe.skipIf(!database)("the automation engine end to end", async () => {
  if (!database) return;
  const scenario = await makeAutomationEngineScenario({
    database,
    now: start,
  });
  const { fixtures, kit, read } = scenario;

  beforeEach(() => scenario.prepare(start));
  afterAll(() => scenario.cleanup());

  /** Ticks until every run of `campaignId` has ended. */
  const settleRuns = (
    campaignId: CampaignId,
    from: Temporal.Instant,
    until: Temporal.Instant
  ) =>
    scenario.runUntil({
      from,
      until,
      settled: async () => {
        const runs = await read.runs(campaignId);
        return runs.length > 0 && runs.every((run) => run.status === "ended");
      },
    });

  describe("story 1: review request", () => {
    test("a second visit within a month gets one email at the next 10:00 after a 2-hour wait", async () => {
      const { campaignId } = await kit.seedActive(reviewRequestFlow, {
        at: start,
      });
      const second = await fixtures.addCustomer("story1-second");
      const once = await fixtures.addCustomer("story1-once");
      await fixtures.book({
        label: "story1-second-first",
        customer: second,
        startsAt: Temporal.Instant.from("2026-10-01T07:00:00Z"),
        endsAt: Temporal.Instant.from("2026-10-01T15:00:00Z"),
      });
      const secondVisit = await fixtures.book({
        label: "story1-second-second",
        customer: second,
        startsAt: Temporal.Instant.from("2026-10-13T07:00:00Z"),
        endsAt: Temporal.Instant.from("2026-10-13T15:00:00Z"),
      });
      const onlyVisit = await fixtures.book({
        label: "story1-once-only",
        customer: once,
        startsAt: Temporal.Instant.from("2026-10-13T07:00:00Z"),
        endsAt: Temporal.Instant.from("2026-10-13T15:00:00Z"),
      });

      const progress = await settleRuns(
        campaignId,
        start,
        start.add({ hours: 48 })
      );

      expect(progress.settled).toBe(true);
      const runs = await read.runs(campaignId);
      const byCustomer = new Map(
        runs.map((run) => [run.dotypos_customer_id, run])
      );
      expect(byCustomer.get(second)).toMatchObject({
        status: "ended",
        outcome: "sent",
        trigger_kind: "reservation-finished",
        trigger_reservation_id: secondVisit,
      });
      expect(iso(byCustomer.get(second).trigger_at)).toBe(
        "2026-10-13T15:00:00Z"
      );
      // 10:00 in Prague on Wednesday, after the 2-hour settle.
      expect(iso(byCustomer.get(second).ended_at)).toBe("2026-10-14T08:00:00Z");
      expect(byCustomer.get(once)).toMatchObject({
        status: "ended",
        outcome: "condition-failed",
        trigger_reservation_id: onlyVisit,
      });
      expect(scenario.resend.mailed()).toEqual([
        testEmailAddress(second.slice(-48)),
      ]);
      const timeline = await read.timeline(byCustomer.get(second).id);
      expect(timeline.map((entry) => entry.kind)).toEqual([
        "started",
        "condition-passed",
        "waiting",
        "woke",
        "waiting",
        "woke",
        "send-queued",
        "sent",
      ]);
    });
  });
});
