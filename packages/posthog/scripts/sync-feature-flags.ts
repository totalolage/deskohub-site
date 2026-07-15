import { createEnv } from "@t3-oss/env-core";
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { z } from "zod";
import { PostHogFeatureFlagConfig } from "../src/feature-flags/config";
import { PostHogFeatureFlagService } from "../src/feature-flags/definitions";
import { PostHogFeatureFlagError } from "../src/feature-flags/errors";
import {
  PostHogFeatureFlagContractFile,
  PostHogFeatureFlagSync,
  runPostHogFeatureFlagSync,
} from "../src/feature-flags/sync";

const mode = process.argv.includes("--check") ? "check" : "sync";

const loadEnv = Effect.try({
  try: () =>
    createEnv({
      server: {
        POSTHOG_FEATURE_FLAGS_API_KEY: z.string().min(1),
        POSTHOG_HOST: z.url().default("https://eu.posthog.com"),
        POSTHOG_PROJECT_ID: z.string().min(1),
      },
      runtimeEnv: process.env,
      emptyStringAsUndefined: true,
      onValidationError: () => {
        throw new Error("Invalid PostHog feature flag sync environment.");
      },
    }),
  catch: () =>
    new PostHogFeatureFlagError({
      message: "Invalid PostHog feature flag sync environment.",
    }),
});

const program = Effect.gen(function* () {
  const env = yield* loadEnv;
  const featureFlagServiceLive = PostHogFeatureFlagService.Live.pipe(
    Layer.provide(
      PostHogFeatureFlagConfig.from({
        apiKey: env.POSTHOG_FEATURE_FLAGS_API_KEY,
        host: new URL(env.POSTHOG_HOST),
        projectId: env.POSTHOG_PROJECT_ID,
      })
    ),
    Layer.provide(FetchHttpClient.layer)
  );
  const featureFlagSyncLive = PostHogFeatureFlagSync.Live.pipe(
    Layer.provide(
      Layer.merge(featureFlagServiceLive, PostHogFeatureFlagContractFile.Live)
    )
  );

  return yield* runPostHogFeatureFlagSync(mode).pipe(
    Effect.tap((result) =>
      Effect.logInfo("PostHog feature flag types synchronized", {
        flagCount: result.flagCount,
        status: result.status,
      })
    ),
    Effect.provide(featureFlagSyncLive)
  );
});

if (import.meta.main) {
  Effect.runPromise(program);
}
