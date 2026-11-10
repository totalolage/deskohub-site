import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { env } from "@/env";

const cronUrl =
  "https://workspace.test/api/cron/workspace/posthog-email-deliveries";

const pollSummary = {
  outcome: "polled",
  trigger: "schedule",
  polled: 12,
  settled: 9,
  expired: 1,
} as const;

type PollSummary = typeof pollSummary | { readonly outcome: "not-configured" };

let pollTriggers: string[] = [];
let pollResult: PollSummary = pollSummary;

const FakePolling = Context.Service<
  FakePolling,
  { readonly poll: (trigger: string) => Effect.Effect<PollSummary> }
>()("@test/FakePostHogEmailDeliveryPolling");

Object.assign(FakePolling, {
  Live: Layer.succeed(FakePolling, {
    poll: (trigger) =>
      Effect.sync(() => {
        pollTriggers.push(trigger);
        return pollResult;
      }),
  }),
});

mock.module("@/shared/backend/email/posthog-email-delivery-polling", () => ({
  PostHogEmailDeliveryPolling: FakePolling,
}));

const { GET } = await import("./route");

beforeEach(() => {
  pollTriggers = [];
  pollResult = pollSummary;
});

const runCron = () =>
  GET(
    new Request(cronUrl, {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    })
  );

describe("PostHog email delivery cron route", () => {
  test("runs one scheduled poll and returns its summary", async () => {
    const response = await runCron();

    expect(response.status).toBe(200);
    expect(pollTriggers).toEqual(["schedule"]);
    expect(await response.json()).toEqual(pollSummary);
  });

  test("succeeds when the deployment has no PostHog email secret key", async () => {
    pollResult = { outcome: "not-configured" };

    const response = await runCron();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "not-configured" });
  });
});
