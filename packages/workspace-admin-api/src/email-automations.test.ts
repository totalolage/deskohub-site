import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Result, Schema } from "effect";
import {
  AutomationActivation,
  AutomationDetail,
  AutomationEngineHealth,
  AutomationFlow,
  AutomationFlowUpdate,
  AutomationPreviewRef,
  AutomationRunListInput,
  AutomationRunStats,
  AutomationRunSummary,
  AutomationRunTimelineEntry,
  scheduleMinutesOffTick,
} from "./email-automations";

const decodeFlow = Schema.decodeUnknownResult(AutomationFlow);
const encodeFlow = Schema.encodeResult(AutomationFlow);

/** Story 1: a review request after a second visit within a month. */
const reviewRequestFlow = `{
  "trigger": { "_tag": "ReservationFinished" },
  "steps": [
    {
      "_tag": "Condition",
      "id": "second-visit-within-a-month",
      "filter": {
        "_tag": "Group", "operator": "and", "filters": [
          { "attribute": "reservationCount", "_tag": "Condition",
            "params": { "dateBasis": "visit",
                        "period": { "_tag": "TriggerWindow", "side": "before", "count": 1, "unit": "month" } },
            "operator": "eq", "value": 2 },
          { "attribute": "firstVisit", "_tag": "Condition",
            "operator": "in",
            "value": { "_tag": "TriggerWindow", "side": "before", "count": 1, "unit": "month" } },
          { "attribute": "campaignEmailCount", "_tag": "Condition",
            "params": { "purpose": "any", "period": { "_tag": "AnyTime" }, "campaign": { "_tag": "This" } },
            "operator": "eq", "value": 0 }
        ]
      }
    },
    { "_tag": "Wait", "id": "settle", "wait": { "_tag": "Duration", "count": 2, "unit": "hour" } },
    { "_tag": "Wait", "id": "ten-oclock", "wait": { "_tag": "Calendar", "expression": { "hours": [10] } } },
    { "_tag": "Send", "id": "send" }
  ]
}`;

/** Story 2: a weekly come-back offer. */
const comeBackOfferFlow = `{
  "trigger": { "_tag": "Schedule", "calendar": { "hours": [10], "weekdays": ["monday"] } },
  "steps": [
    { "_tag": "Condition", "id": "not-offered-recently",
      "filter": { "_tag": "Group", "operator": "and", "filters": [
        { "attribute": "campaignEmailCount", "_tag": "Condition",
          "params": { "purpose": "any", "period": { "_tag": "Last", "count": 3, "unit": "month" },
                      "campaign": { "_tag": "This" } },
          "operator": "eq", "value": 0 } ] } },
    { "_tag": "Send", "id": "send" }
  ]
}`;

const send = { _tag: "Send", id: "send" };
const settle = {
  _tag: "Wait",
  id: "settle",
  wait: { _tag: "Duration", count: 2, unit: "hour" },
};
const flowOf = (steps: ReadonlyArray<unknown>) => ({
  trigger: { _tag: "AccountCreated" },
  steps,
});

describe("automation flow contract", () => {
  test.each([
    ["story 1", reviewRequestFlow],
    ["story 2", comeBackOfferFlow],
  ])("%s round-trips byte for byte", (_, json) => {
    const wire = JSON.stringify(JSON.parse(json));
    const flow = Result.getOrThrow(decodeFlow(JSON.parse(json)));

    expect(JSON.stringify(Result.getOrThrow(encodeFlow(flow)))).toBe(wire);
  });

  test("accepts twenty steps", () => {
    const waits = Array.from({ length: 19 }, (_, index) => ({
      ...settle,
      id: `wait-${index}`,
    }));

    expect(Result.isSuccess(decodeFlow(flowOf([...waits, send])))).toBe(true);
  });

  test.each([
    ["no steps", []],
    ["no send step", [settle]],
    ["two send steps", [send, { ...send, id: "send-again" }]],
    ["a send step before a wait", [send, settle]],
    ["duplicate step ids", [settle, settle, send]],
    [
      "more than twenty steps",
      [
        ...Array.from({ length: 20 }, (_, index) => ({
          ...settle,
          id: `wait-${index}`,
        })),
        send,
      ],
    ],
  ])("rejects %s", (_, steps) => {
    expect(Result.isFailure(decodeFlow(flowOf(steps)))).toBe(true);
  });
});

describe("automation operation inputs", () => {
  const decodeStrict = (schema: Schema.Decoder<unknown>, input: unknown) =>
    Schema.decodeUnknownResult(schema)(input);

  test("reject unknown keys", () => {
    expect(
      Result.isFailure(
        decodeStrict(AutomationFlowUpdate, {
          campaignId: "campaign-1",
          flow: JSON.parse(comeBackOfferFlow),
          note: "unexpected",
        })
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        decodeStrict(AutomationRunListInput, {
          campaignId: "campaign-1",
          status: "ended",
        })
      )
    ).toBe(true);
  });

  test("narrow runs by a known skip reason only", () => {
    const input = { campaignId: "campaign-1", outcome: "skipped" };

    expect(
      Result.getOrThrow(
        decodeStrict(AutomationRunListInput, {
          ...input,
          skipReason: "missing-email",
        })
      )
    ).toEqual({ ...input, skipReason: "missing-email" });
    for (const skipReason of ["evaluation-unavailable", "Missing-Email", ""]) {
      expect(
        Result.isFailure(
          decodeStrict(AutomationRunListInput, { ...input, skipReason })
        )
      ).toBe(true);
    }
  });

  test.each([
    [AutomationPreviewRef, { previewId: "preview-1", limit: 201 }],
    [AutomationRunListInput, { campaignId: "campaign-1", limit: 101 }],
  ])("caps the page size", (schema, input) => {
    expect(Result.isFailure(decodeStrict(schema, input))).toBe(true);
  });
});

describe("automation responses", () => {
  test("decode an older server's detail with defaults", () => {
    const detail = Result.getOrThrow(
      Schema.decodeUnknownResult(AutomationDetail)({
        campaignId: "campaign-1",
        status: "draft",
        updatedAt: "2026-10-19T10:00:00.000Z",
      })
    );

    expect(detail).toEqual({
      campaignId: detail.campaignId,
      status: "draft",
      flow: null,
      trigger: null,
      activeVersion: null,
      versionCount: 0,
      pendingChanges: false,
      activation: { _tag: "PreviewRequired" },
      acceptingSince: null,
      pausedAt: null,
      archivedAt: null,
      nextFireAt: null,
      updatedAt: "2026-10-19T10:00:00.000Z",
    });
  });

  test("decode an older server's run and counts with contacts and skip reasons unknown", () => {
    const run = {
      runId: "run-1",
      campaignId: "campaign-1",
      versionNumber: 1,
      customerId: "customer-1",
      triggerKind: "account-created",
      triggerAt: "2026-10-19T10:00:00.000Z",
      state: "ended",
      phase: null,
      stepId: "send",
      dueAt: null,
      outcome: "skipped",
      outcomeReason: "missing-email",
      sendId: null,
      startedAt: "2026-10-19T10:00:00.000Z",
      endedAt: "2026-10-19T10:01:00.000Z",
    };

    expect(
      Result.getOrThrow(Schema.decodeUnknownResult(AutomationRunSummary)(run))
    ).toMatchObject({
      customerName: null,
      customerEmail: null,
      customerProfileStatus: "unavailable",
    });
    expect(
      Result.getOrThrow(
        Schema.decodeUnknownResult(AutomationRunStats)({
          campaignId: "campaign-1",
        })
      ).bySkipReason
    ).toEqual({
      "missing-from-dotypos": 0,
      "deleted-customer": 0,
      "missing-email": 0,
      "invalid-email": 0,
      "consent-withdrawn": 0,
      "outside-test-domain": 0,
    });
  });

  test("refuse counts by skip reason that leave a reason out", () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(AutomationRunStats)({
          campaignId: "campaign-1",
          bySkipReason: { "missing-email": 2 },
        })
      )
    ).toBe(true);
  });

  test("round-trip a run's live contact and the counts by skip reason", () => {
    const run = Result.getOrThrow(
      Schema.decodeUnknownResult(AutomationRunSummary)({
        runId: "run-1",
        campaignId: "campaign-1",
        versionNumber: 1,
        customerId: "customer-1",
        customerName: "Ana Test",
        customerEmail: testEmailAddress("ana"),
        customerProfileStatus: "found",
        triggerKind: "account-created",
        triggerAt: "2026-10-19T10:00:00.000Z",
        state: "active",
        stepId: "send",
        startedAt: "2026-10-19T10:00:00.000Z",
      })
    );
    const stats = Result.getOrThrow(
      Schema.decodeUnknownResult(AutomationRunStats)({
        campaignId: "campaign-1",
        bySkipReason: {
          "missing-from-dotypos": 0,
          "deleted-customer": 0,
          "missing-email": 2,
          "invalid-email": 0,
          "consent-withdrawn": 1,
          "outside-test-domain": 0,
        },
      })
    );

    expect(
      Result.getOrThrow(Schema.encodeResult(AutomationRunSummary)(run))
    ).toMatchObject({
      customerName: "Ana Test",
      customerEmail: testEmailAddress("ana"),
      customerProfileStatus: "found",
    });
    expect(
      Result.getOrThrow(Schema.encodeResult(AutomationRunStats)(stats))
        .bySkipReason
    ).toMatchObject({ "missing-email": 2, "consent-withdrawn": 1 });
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(AutomationRunSummary)({
          ...Result.getOrThrow(Schema.encodeResult(AutomationRunSummary)(run)),
          customerProfileStatus: "stale",
        })
      )
    ).toBe(true);
  });

  test("decode every activation state", () => {
    for (const activation of [
      { _tag: "PreviewRequired" },
      { _tag: "PreviewRunning", previewId: "p", unitsDone: 1, unitsTotal: 3 },
      { _tag: "Ready", previewId: "p", draftHash: "hash" },
      { _tag: "Published" },
    ]) {
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(AutomationActivation)(activation)
        )
      ).toBe(true);
    }
  });

  test("decode an unknown or unreadable timeline entry as a generic one", () => {
    const decodeEntry = Schema.decodeUnknownResult(AutomationRunTimelineEntry);
    const entry = {
      sequence: 2,
      stepId: "settle",
      at: "2026-10-19T10:00:00.000Z",
    };

    expect(
      Result.getOrThrow(
        decodeEntry({
          ...entry,
          kind: "waiting",
          detail: { dueAt: "2026-10-19T12:00:00.000Z" },
        })
      )
    ).toEqual({
      ...entry,
      kind: "waiting",
      detail: { dueAt: "2026-10-19T12:00:00.000Z" },
    } as never);
    expect(
      Result.getOrThrow(
        decodeEntry({ ...entry, kind: "rescheduled", detail: { by: 1 } })
      )
    ).toEqual({ ...entry, kind: "rescheduled", detail: { by: 1 } } as never);
    expect(
      Result.getOrThrow(decodeEntry({ ...entry, kind: "waiting", detail: {} }))
    ).toEqual({ ...entry, kind: "waiting", detail: {} } as never);
  });
});

describe("automation engine health", () => {
  const report = {
    lastPlannedAt: "2026-10-19T10:00:00.000Z",
    sweepLagSeconds: 60,
    reconcileLagSeconds: 8160,
    deadlineMisses: 0,
    warnings: ["reconcile-stalled"],
  };
  // `AutomationEngineHealth` as dhw 1.24.0 to 1.27.0 decode it: a closed
  // list of warnings and no reconcile lag.
  const ReleasedAutomationEngineHealth = Schema.Struct({
    sweepLagSeconds: Schema.NullOr(Schema.Finite),
    warnings: Schema.Array(
      Schema.Literals([
        "planner-stale",
        "sweep-lagging",
        "event-backlog",
        "unit-backlog",
        "schedule-lagging",
        "falling-behind",
      ])
    ),
  });

  test("decodes a later server's warning by its code", () => {
    const decoded = Result.getOrThrow(
      Schema.decodeUnknownResult(AutomationEngineHealth)({
        ...report,
        warnings: ["reconcile-stalled", "synthetic-later-warning"],
      })
    );

    expect(decoded.warnings).toEqual([
      "reconcile-stalled",
      "synthetic-later-warning",
    ]);
  });

  test("decodes an older server's report without reconcile lag", () => {
    const { reconcileLagSeconds: _, ...older } = report;
    const decoded = Result.getOrThrow(
      Schema.decodeUnknownResult(AutomationEngineHealth)({
        ...older,
        warnings: [],
      })
    );

    expect(decoded.reconcileLagSeconds).toBeNull();
  });

  test("released dhw reads the reconcile lag's report but not its warning", () => {
    const decodeReleased = Schema.decodeUnknownResult(
      ReleasedAutomationEngineHealth
    );

    expect(Result.isSuccess(decodeReleased({ ...report, warnings: [] }))).toBe(
      true
    );
    expect(Result.isFailure(decodeReleased(report))).toBe(true);
  });
});

describe("scheduleMinutesOffTick", () => {
  test.each([
    [{ hours: [9] }, []],
    [{ minutes: [0, 15, 30, 45] }, []],
    [{ minutes: [45, 7, 0, 1] }, [1, 7]],
  ] as const)("%j fires off the engine's ticks at %j", (calendar, minutes) => {
    expect(scheduleMinutesOffTick(calendar)).toEqual(minutes);
  });
});
