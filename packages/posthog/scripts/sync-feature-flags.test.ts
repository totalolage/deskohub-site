import { expect, test } from "bun:test";
import { Effect } from "effect";
import { PostHogFeatureFlagError } from "../src/feature-flags/errors";
import { loadPostHogFeatureFlagEnv } from "./sync-feature-flags";

test("preserves the environment validation failure as the error cause", async () => {
  const error = await Effect.runPromise(
    loadPostHogFeatureFlagEnv({}).pipe(Effect.flip)
  );

  expect(error).toBeInstanceOf(PostHogFeatureFlagError);
  expect(error.cause).toBeInstanceOf(Error);
  expect((error.cause as Error & { cause?: unknown }).cause).toBeArray();
});
