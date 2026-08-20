import { Effect, Layer } from "effect";
import type { PostHogProjectId } from "../identifiers";
import {
  loadPostHogFeatureFlagDefinitions,
  PostHogFeatureFlagService,
} from "./definitions";
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
    const featureFlagSyncLive = PostHogFeatureFlagSync.Default.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(PostHogFeatureFlagService, {
            listDefinitions: loadPostHogFeatureFlagDefinitions(options),
          }),
          PostHogFeatureFlagContractFile.from(options.outputFile)
        )
      )
    );

    return runPostHogFeatureFlagSync.pipe(Effect.provide(featureFlagSyncLive));
  }
);

export { PostHogFeatureFlagError } from "./errors";
export type { PostHogFeatureFlagSyncResult } from "./sync";
