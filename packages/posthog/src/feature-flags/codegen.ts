import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { PostHogProjectId } from "../identifiers";
import { PostHogFeatureFlagConfig } from "./config";
import { PostHogFeatureFlagService } from "./definitions";
import type { PostHogFeatureFlagError } from "./errors";
import {
  PostHogFeatureFlagContractFile,
  PostHogFeatureFlagSync,
  type PostHogFeatureFlagSyncResult,
  runPostHogFeatureFlagSync,
} from "./sync";

export interface GeneratePostHogFeatureFlagContractOptions {
  readonly apiKey: string;
  readonly host: URL;
  readonly outputFile: string | URL;
  readonly projectId: PostHogProjectId;
}

export const generatePostHogFeatureFlagContract = Effect.fn(
  "generatePostHogFeatureFlagContract"
)(
  (
    options: GeneratePostHogFeatureFlagContractOptions
  ): Effect.Effect<PostHogFeatureFlagSyncResult, PostHogFeatureFlagError> => {
    const featureFlagServiceLive = PostHogFeatureFlagService.Default.pipe(
      Layer.provide(
        PostHogFeatureFlagConfig.from({
          apiKey: options.apiKey,
          host: options.host,
          projectId: options.projectId,
        })
      ),
      Layer.provide(FetchHttpClient.layer)
    );
    const featureFlagSyncLive = PostHogFeatureFlagSync.Default.pipe(
      Layer.provide(
        Layer.merge(
          featureFlagServiceLive,
          PostHogFeatureFlagContractFile.from(options.outputFile)
        )
      )
    );

    return runPostHogFeatureFlagSync.pipe(Effect.provide(featureFlagSyncLive));
  }
);

export { PostHogFeatureFlagError } from "./errors";
export type { PostHogFeatureFlagSyncResult } from "./sync";
