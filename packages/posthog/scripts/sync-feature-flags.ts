import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { PostHogFeatureFlagRuntimeConfig } from "../src/feature-flags/config";
import { PostHogFeatureFlagService } from "../src/feature-flags/definitions";
import {
  PostHogFeatureFlagContractFile,
  PostHogFeatureFlagSync,
  runPostHogFeatureFlagSync,
} from "../src/feature-flags/sync";

const mode = process.argv.includes("--check") ? "check" : "sync";

const featureFlagServiceLive = PostHogFeatureFlagService.Live.pipe(
  Layer.provide(PostHogFeatureFlagRuntimeConfig.Live),
  Layer.provide(FetchHttpClient.layer)
);

const featureFlagSyncLive = PostHogFeatureFlagSync.Live.pipe(
  Layer.provide(
    Layer.merge(featureFlagServiceLive, PostHogFeatureFlagContractFile.Live)
  )
);

if (import.meta.main) {
  Effect.runPromise(
    runPostHogFeatureFlagSync(mode).pipe(
      Effect.tap((result) =>
        Effect.logInfo("PostHog feature flag types synchronized", {
          flagCount: result.flagCount,
          status: result.status,
        })
      ),
      Effect.provide(featureFlagSyncLive)
    )
  );
}
