import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { PostHogProjectId } from "@deskohub/posthog/identifiers";
import { Duration, Option, Redacted } from "effect";
import {
  getPostHogPersonDeletionAttemptTimeout,
  getPostHogPersonDeletionWorstCaseDuration,
  getPostHogPersonPrivacyConfig,
  postHogPersonDeletionBudget,
} from "./posthog-person-privacy.config";

const environment = {
  POSTHOG_API_HOST: "https://eu.posthog.test",
  POSTHOG_PERSON_PRIVACY_API_KEY: "synthetic-person-privacy-key",
  POSTHOG_PROJECT_ID: PostHogProjectId.make("1044"),
  VERCEL_ENV: "production",
} as const;

describe("PostHog person privacy config", () => {
  test("configures person deletion from the person privacy key and project", () => {
    const { persons } = getPostHogPersonPrivacyConfig(environment);

    expect(Option.isSome(persons)).toBe(true);
    const config = Option.getOrThrow(persons);
    expect(Redacted.value(config.apiKey)).toBe(
      environment.POSTHOG_PERSON_PRIVACY_API_KEY
    );
    expect(String(config.apiKey)).not.toContain(
      environment.POSTHOG_PERSON_PRIVACY_API_KEY
    );
    expect(config.host.origin).toBe("https://eu.posthog.test");
    expect(config.projectId).toBe(environment.POSTHOG_PROJECT_ID);
  });

  test("leaves person deletion unavailable without the key or the project", () => {
    for (const missing of [
      "POSTHOG_PERSON_PRIVACY_API_KEY",
      "POSTHOG_PROJECT_ID",
    ] as const) {
      const { persons } = getPostHogPersonPrivacyConfig({
        ...environment,
        [missing]: undefined,
      });
      expect(Option.isNone(persons)).toBe(true);
    }
  });

  test("waits 5 seconds per attempt in production and 30 elsewhere", () => {
    expect(
      Duration.toSeconds(getPostHogPersonDeletionAttemptTimeout("production"))
    ).toBe(5);
    expect(
      Duration.toSeconds(getPostHogPersonDeletionAttemptTimeout("preview"))
    ).toBe(30);
  });

  test("keeps the after-response budget inside Vercel's 300-second function limit", () => {
    expect(
      Duration.isLessThan(postHogPersonDeletionBudget, Duration.seconds(300))
    ).toBe(true);
  });

  test("fits every deployment's retried PostHog request inside the after-response budget", () => {
    for (const stage of ["production", "preview", "development"] as const) {
      expect(
        Duration.isLessThanOrEqualTo(
          getPostHogPersonDeletionWorstCaseDuration(stage),
          postHogPersonDeletionBudget
        )
      ).toBe(true);
    }
  });
});
