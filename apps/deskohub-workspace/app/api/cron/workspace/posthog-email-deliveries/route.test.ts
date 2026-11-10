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

let pollTriggers: string[] = [];

const FakePolling = Context.Service<
  FakePolling,
  { readonly poll: (trigger: string) => Effect.Effect<typeof pollSummary> }
>()("@test/FakePostHogEmailDeliveryPolling");

Object.assign(FakePolling, {
  Live: Layer.succeed(FakePolling, {
    poll: (trigger) =>
      Effect.sync(() => {
        pollTriggers.push(trigger);
        return pollSummary;
      }),
  }),
});

mock.module("@/shared/backend/email/posthog-email-delivery-polling", () => ({
  PostHogEmailDeliveryPolling: FakePolling,
}));

const { GET } = await import("./route");

beforeEach(() => {
  pollTriggers = [];
});

describe("PostHog email delivery cron route", () => {
  test("runs one scheduled poll and returns its summary", async () => {
    const response = await GET(
      new Request(cronUrl, {
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      })
    );

    expect(response.status).toBe(200);
    expect(pollTriggers).toEqual(["schedule"]);
    expect(await response.json()).toEqual(pollSummary);
  });
});
