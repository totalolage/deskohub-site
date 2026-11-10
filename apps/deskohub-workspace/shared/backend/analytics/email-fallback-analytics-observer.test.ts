import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import type { EmailFallbackEvent } from "@deskohub/email";
import { Effect, Logger } from "effect";
import { makeEmailFallbackAnalyticsObserver } from "./email-fallback-analytics-observer";
import { recordServerAnalytics } from "./server-analytics.service.mock";

const fallback: EmailFallbackEvent = {
  stream: "marketing",
  category: "email-campaign",
  failedProvider: "posthog",
  nextProvider: "resend",
  errorKind: "EmailServiceError",
  errorCode: "sending_paused",
  at: new Date("2099-06-17T12:00:00.000Z"),
};

const observeFallbacks = async (
  events: readonly Partial<EmailFallbackEvent>[]
) => {
  const recorder = recordServerAnalytics();
  const warnings: unknown[][] = [];
  await Effect.runPromise(
    makeEmailFallbackAnalyticsObserver.pipe(
      Effect.flatMap((observer) =>
        Effect.forEach(events, (event) =>
          observer.onFallback({ ...fallback, ...event })
        )
      ),
      Effect.provide(recorder.layer),
      Effect.provide(
        Logger.layer([
          Logger.make(({ logLevel, message }) => {
            if (logLevel === "Warn") warnings.push(message as unknown[]);
          }),
        ])
      )
    )
  );
  return { messages: recorder.messages, warnings };
};

test("captures a provider fallback as an event about no one", async () => {
  const { messages } = await observeFallbacks([fallback, fallback]);

  const [first, second] = messages;
  expect(messages).toHaveLength(2);
  expect(first).toMatchObject({
    event: "email provider fallback",
    properties: {
      stream: "marketing",
      category: "email-campaign",
      failed_provider: "posthog",
      next_provider: "resend",
      error_kind: "EmailServiceError",
      error_code: "sending_paused",
      $process_person_profile: false,
    },
    timestamp: Temporal.Instant.from("2099-06-17T12:00:00.000Z"),
  });
  expect(first?.distinctId).not.toBe(second?.distinctId);
});

test("omits the category and code a fallback doesn't have", async () => {
  const { messages } = await observeFallbacks([
    { category: undefined, errorKind: "NetworkError", errorCode: undefined },
  ]);

  expect(messages[0]?.properties).toMatchObject({
    error_kind: "NetworkError",
  });
  expect(messages[0]?.properties).not.toHaveProperty("category");
  expect(messages[0]?.properties).not.toHaveProperty("error_code");
});

test("logs each fallback as a warning with its facts", async () => {
  const { warnings } = await observeFallbacks([fallback]);

  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContainEqual({
    stream: "marketing",
    category: "email-campaign",
    failedProvider: "posthog",
    nextProvider: "resend",
    errorKind: "EmailServiceError",
    errorCode: "sending_paused",
  });
});
