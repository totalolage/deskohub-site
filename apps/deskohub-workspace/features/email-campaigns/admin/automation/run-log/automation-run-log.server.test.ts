import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AutomationFlow,
  OperationNotFound,
  OperationUnavailable,
} from "@deskohub/workspace-admin-api";
import { Effect, Result, Schema } from "effect";
import { campaignIdSchema } from "../../../campaign-identifiers";
import { stubCampaignPageQueries } from "../../campaign-operation-query.test-utils";
import {
  activeVersionFixture,
  automationDetailFixture,
  automationFlowFixture,
  fixtureCampaignId,
} from "../activation/automation-detail.test-utils";
import type { AutomatedCampaign } from "../automated-campaign.server";
import {
  automationEngineHealthFixture,
  automationRunDetailFixture,
  automationRunFixture,
  automationRunStatsFixture,
} from "./automation-run.test-utils";
import { parseAutomationRunFilters } from "./automation-run-filters";

const port = stubCampaignPageQueries();
const lookups = { discountGroups: [] };
const loadAudienceValueLookups = mock(async () => lookups);
mock.module("../../audiences/audience-value-lookups.server", () => ({
  loadAudienceValueLookups,
}));

const { loadAutomationRun, loadAutomationRunLog } = await import(
  "./automation-run-log.server"
);

const campaignId = campaignIdSchema.make(fixtureCampaignId);
const workingFlow = automationFlowFixture();
/** The flow a published version froze: the working copy minus its wait. */
const versionFlow = automationFlowFixture({
  steps: Schema.encodeSync(AutomationFlow)(workingFlow).steps.filter(
    ({ id }) => id !== "pause"
  ),
});
const automated = (
  automation = automationDetailFixture()
): AutomatedCampaign => ({
  campaign: { id: campaignId } as AutomatedCampaign["campaign"],
  automation,
});
const notFoundSignal = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

const inputsOf = (name: string) =>
  port.invoked.filter((call) => call.name === name).map(({ input }) => input);

beforeEach(() => {
  port.invoked.length = 0;
  loadAudienceValueLookups.mockClear();
  port.responses = {
    getAutomationRunStats: Effect.succeed(automationRunStatsFixture()),
    listAutomationVersions: Effect.succeed([]),
    listAutomationRuns: Effect.succeed({ runs: [], nextCursor: null }),
    getAutomationEngineHealth: Effect.succeed(automationEngineHealthFixture()),
    getAutomationVersion: Effect.succeed({ flow: versionFlow }),
  };
});

describe("loadAutomationRunLog", () => {
  test("asks the port for every filter in the URL", async () => {
    await loadAutomationRunLog(
      automated(),
      parseAutomationRunFilters({
        state: "ended",
        outcome: "skipped",
        skipReason: "missing-email",
        step: "send",
        version: "2",
        customer: "dotypos-customer-7",
        cursor: "cursor-2",
      })
    );

    expect(inputsOf("listAutomationRuns")).toEqual([
      {
        campaignId,
        versionNumber: 2,
        state: "ended",
        outcome: "skipped",
        skipReason: "missing-email",
        stepId: "send",
        customerId: "dotypos-customer-7",
        cursor: "cursor-2",
      },
    ]);
    expect(inputsOf("getAutomationRunStats")).toEqual([
      { campaignId, versionNumber: 2 },
    ]);
    expect(inputsOf("listAutomationVersions")).toEqual([{ campaignId }]);
    expect(inputsOf("getAutomationEngineHealth")).toEqual([{}]);
  });

  test("leaves out filters the URL doesn't set, or sets to values the port rejects", async () => {
    await loadAutomationRunLog(
      automated(),
      parseAutomationRunFilters({
        state: "dozing",
        skipReason: "bored",
        version: "0",
      })
    );

    expect(inputsOf("listAutomationRuns")).toEqual([{ campaignId }]);
    expect(inputsOf("getAutomationRunStats")).toEqual([{ campaignId }]);
  });

  test("keeps the counts, the runs and the engine health independent", async () => {
    port.responses.listAutomationRuns = Effect.fail(
      new OperationUnavailable({ code: "dotypos-unavailable", message: "x" })
    );
    port.responses.getAutomationEngineHealth = Effect.fail(
      new OperationUnavailable({ code: "health-unavailable", message: "x" })
    );

    const log = await loadAutomationRunLog(
      automated(),
      parseAutomationRunFilters({})
    );

    expect(Result.isSuccess(log.summary)).toBe(true);
    expect(Result.isFailure(log.runs)).toBe(true);
    expect(Result.isFailure(log.health)).toBe(true);
  });

  test("names steps by the filtered version's flow, and loads each listed run's version once", async () => {
    port.responses.listAutomationRuns = Effect.succeed({
      runs: [
        automationRunFixture({ runId: "run-a", versionNumber: 1 }),
        automationRunFixture({ runId: "run-b", versionNumber: 2 }),
        automationRunFixture({ runId: "run-c", versionNumber: 2 }),
      ],
      nextCursor: null,
    });

    const log = await loadAutomationRunLog(
      automated(),
      parseAutomationRunFilters({ version: "2" })
    );

    expect(log.flow).toEqual(versionFlow);
    expect(
      inputsOf("getAutomationVersion")
        .map((input) => (input as { versionNumber: number }).versionNumber)
        .sort()
    ).toEqual([1, 2]);
  });

  test("names steps by the active version's flow without a version filter", async () => {
    const log = await loadAutomationRunLog(
      automated(
        automationDetailFixture({
          status: "active",
          activeVersion: activeVersionFixture(3),
          versionCount: 3,
        })
      ),
      parseAutomationRunFilters({})
    );

    expect(inputsOf("getAutomationVersion")).toEqual([
      { campaignId, versionNumber: 3 },
    ]);
    expect(log.flow).toEqual(versionFlow);
  });

  test("falls back to the working copy's flow when the version's doesn't load", async () => {
    port.responses.getAutomationVersion = Effect.fail(
      new OperationNotFound({
        code: "automation-version-not-found",
        message: "x",
      })
    );

    const log = await loadAutomationRunLog(
      automated(),
      parseAutomationRunFilters({ version: "2" })
    );

    expect(log.flow).toEqual(workingFlow);
    expect(log.flows.size).toBe(0);
  });
});

describe("loadAutomationRun", () => {
  test("reads the run with its version's flow, without audience names it doesn't need", async () => {
    const run = automationRunDetailFixture({
      timeline: [
        {
          sequence: 1,
          kind: "started",
          stepId: null,
          at: "2026-10-03T08:00:00.000Z",
          detail: {},
        },
      ],
    });
    port.responses.getAutomationRun = Effect.succeed(run);

    const record = await loadAutomationRun(campaignId, "run-1");

    expect(record.run).toEqual(run);
    expect(record.flow).toEqual(versionFlow);
    expect(inputsOf("getAutomationRun")).toEqual([{ runId: "run-1" }]);
    expect(inputsOf("listCampaignAudiences")).toEqual([]);
    expect(loadAudienceValueLookups).not.toHaveBeenCalled();
    expect(record.conditionWording.audiences.size).toBe(0);
  });

  test("loads audience names and lookups to word a failed condition", async () => {
    port.responses.getAutomationRun = Effect.succeed(
      automationRunDetailFixture({
        outcome: "condition-failed",
        stepId: "check",
        timeline: [
          {
            sequence: 1,
            kind: "condition-failed",
            stepId: "check",
            at: "2026-10-03T08:00:00.000Z",
            detail: { failedConditions: [0] },
          },
        ],
      })
    );
    port.responses.listCampaignAudiences = Effect.succeed([
      { id: "regulars", title: "Regulars" },
    ]);

    const record = await loadAutomationRun(campaignId, "run-1");

    expect(record.conditionWording.audiences.get("regulars")).toBe("Regulars");
    expect(record.conditionWording.lookups).toBe(lookups);
  });

  test("still shows the run when the audience names don't load", async () => {
    port.responses.getAutomationRun = Effect.succeed(
      automationRunDetailFixture({
        timeline: [
          {
            sequence: 1,
            kind: "condition-failed",
            stepId: "check",
            at: "2026-10-03T08:00:00.000Z",
            detail: { failedConditions: [0] },
          },
        ],
      })
    );
    port.responses.listCampaignAudiences = Effect.fail(
      new OperationUnavailable({ code: "unavailable", message: "x" })
    );

    const record = await loadAutomationRun(campaignId, "run-1");

    expect(record.conditionWording.audiences.size).toBe(0);
  });

  test("is not found for another campaign's run", async () => {
    port.responses.getAutomationRun = Effect.succeed(
      automationRunDetailFixture({ campaignId: "another-campaign" })
    );

    await expect(loadAutomationRun(campaignId, "run-1")).rejects.toMatchObject(
      notFoundSignal
    );
  });

  test("is not found for a missing run", async () => {
    port.responses.getAutomationRun = Effect.fail(
      new OperationNotFound({ code: "automation-run-not-found", message: "x" })
    );

    await expect(loadAutomationRun(campaignId, "run-1")).rejects.toMatchObject(
      notFoundSignal
    );
  });

  test("is not found for a malformed id, without asking the port", async () => {
    await expect(loadAutomationRun(campaignId, "")).rejects.toMatchObject(
      notFoundSignal
    );
    expect(port.invoked).toEqual([]);
  });
});
