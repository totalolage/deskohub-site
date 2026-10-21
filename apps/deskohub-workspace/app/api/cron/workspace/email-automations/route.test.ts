import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { env } from "@/env";

const cronUrl = "https://workspace.test/api/cron/workspace/email-automations";

const planSummary = {
  plannedAt: "2027-03-05T08:15:00Z",
  reaped: { requeued: 0, resent: 0, dropped: 0 },
  sweepPagesPlanned: 1,
  sweepPagesReplanned: 0,
  eventsReconciled: 0,
  pruned: { units: 0, previews: 0, events: 0 },
  promoted: 1,
  inFlightByKind: { "sweep-page": 1 },
  failingByKind: {},
};

interface IFakePlanner {
  readonly plan: Effect.Effect<typeof planSummary, Error>;
}

let planRuns = 0;
let failPlanning = false;

const FakePlanner = Context.Service<FakePlanner, IFakePlanner>()(
  "@test/FakeAutomationPlanner"
);

const fakePlannerLayer = Layer.succeed(FakePlanner, {
  plan: Effect.suspend(() => {
    planRuns += 1;
    return failPlanning
      ? Effect.fail(new Error("database unavailable"))
      : Effect.succeed(planSummary);
  }),
}) as Layer.Layer<FakePlanner>;

Object.assign(FakePlanner, { Live: fakePlannerLayer });

mock.module(
  "@/features/email-campaigns/automation/backend/automation-planner.service",
  () => ({ AutomationPlanner: FakePlanner })
);

const callCron = async (headers?: HeadersInit) => {
  const { GET } = (await import("./route")) as {
    GET: (request: Request) => Promise<Response>;
  };
  return GET(new Request(cronUrl, { headers }));
};

describe("email automation planner cron route", () => {
  beforeEach(() => {
    planRuns = 0;
    failPlanning = false;
  });

  test("rejects requests without the cron secret", async () => {
    const response = await callCron();

    expect(response.status).toBe(401);
    expect(planRuns).toBe(0);
  });

  test("rejects a wrong bearer secret", async () => {
    const response = await callCron({
      authorization: "Bearer not-the-secret",
    });

    expect(response.status).toBe(401);
    expect(planRuns).toBe(0);
  });

  test("runs one planner tick and returns its summary", async () => {
    const response = await callCron({
      authorization: `Bearer ${env.CRON_SECRET}`,
    });

    expect(response.status).toBe(200);
    expect(planRuns).toBe(1);
    await expect(response.json()).resolves.toEqual(planSummary);
  });

  test("returns a 500 when planning fails", async () => {
    failPlanning = true;
    const response = await callCron({
      authorization: `Bearer ${env.CRON_SECRET}`,
    });

    expect(response.status).toBe(500);
    expect(planRuns).toBe(1);
    await expect(response.json()).resolves.toEqual({
      error: "Email automation planning failed",
    });
  });
});
