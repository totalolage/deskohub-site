import { expect, test } from "bun:test";
import { Effect } from "effect";
import { PostHogFeatureFlagConfig } from "./config";

test("PostHogFeatureFlagConfig.from provides the caller-owned config", () => {
  const config = {
    apiKey: "api-key",
    host: new URL("https://eu.posthog.com"),
    projectId: "project-id",
  };

  const provided = Effect.runSync(
    PostHogFeatureFlagConfig.pipe(
      Effect.provide(PostHogFeatureFlagConfig.from(config))
    )
  );

  expect(provided).toEqual(config);
});
