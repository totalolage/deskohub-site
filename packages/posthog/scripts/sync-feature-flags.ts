import { Config, Effect, Layer, Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { PostHogFeatureFlagConfig } from "../src/feature-flags/config";
import { PostHogFeatureFlagService } from "../src/feature-flags/definitions";
import {
  PostHogFeatureFlagContractFile,
  PostHogFeatureFlagSync,
  runPostHogFeatureFlagSync,
} from "../src/feature-flags/sync";

const mode = process.argv.includes("--check") ? "check" : "sync";

const loadConfig = Config.all({
  apiKey: Config.redacted("POSTHOG_FEATURE_FLAGS_API_KEY"),
  host: Config.url("POSTHOG_HOST").pipe(
    Config.withDefault(new URL("https://us.posthog.com"))
  ),
  projectId: Config.nonEmptyString("POSTHOG_PROJECT_ID"),
});

const program = Effect.gen(function* () {
  const config = yield* loadConfig;
  const featureFlagServiceLive = PostHogFeatureFlagService.Live.pipe(
    Layer.provide(
      Layer.succeed(
        PostHogFeatureFlagConfig,
        PostHogFeatureFlagConfig.of({
          apiKey: Redacted.value(config.apiKey),
          host: config.host,
          projectId: config.projectId,
        })
      )
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
