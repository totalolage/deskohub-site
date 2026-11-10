import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Duration, Option, Redacted } from "effect";
import { getPostHogEmailStatusClientConfig } from "./posthog-email-status-reader";

const environment = {
  POSTHOG_API_HOST: "https://eu.posthog.test",
  POSTHOG_EMAIL_SECRET_KEY: "synthetic-email-secret-key",
  VERCEL_ENV: "production",
} as const;

describe("PostHog email status client config", () => {
  test("reads statuses from the API host with the redacted email secret key", () => {
    const config = Option.getOrThrow(
      getPostHogEmailStatusClientConfig(environment)
    );

    expect(config.host).toBe("https://eu.posthog.test");
    expect(Redacted.value(config.secretKey)).toBe(
      environment.POSTHOG_EMAIL_SECRET_KEY
    );
    expect(String(config.secretKey)).not.toContain(
      environment.POSTHOG_EMAIL_SECRET_KEY
    );
  });

  test.each([
    ["production", 5],
    ["preview", 30],
    ["development", 30],
  ] as const)("waits for each %s status read %p seconds", (stage, seconds) => {
    const config = Option.getOrThrow(
      getPostHogEmailStatusClientConfig({ ...environment, VERCEL_ENV: stage })
    );

    expect(
      Duration.toSeconds(Duration.fromInputUnsafe(config.timeout ?? 0))
    ).toBe(seconds);
  });

  test.each([
    ["no", undefined],
    ["a blank", " "],
  ])("leaves statuses unread with %s email secret key", (_, secretKey) => {
    expect(
      Option.isNone(
        getPostHogEmailStatusClientConfig({
          ...environment,
          POSTHOG_EMAIL_SECRET_KEY: secretKey,
        })
      )
    ).toBe(true);
  });
});
