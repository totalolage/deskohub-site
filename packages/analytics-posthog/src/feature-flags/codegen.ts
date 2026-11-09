import { Effect, Layer } from "effect";
import type { PostHogProjectId } from "../identifiers";
import {
  loadPostHogFeatureFlagDefinitions,
  type PostHogFeatureFlagDefinition,
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

export interface GeneratePostHogFeatureFlagContractFromDefinitionsOptions {
  readonly definitions: readonly PostHogFeatureFlagDefinition[];
  readonly outputFile: string | URL;
}

export const generatePostHogFeatureFlagContract = Effect.fn(
  "generatePostHogFeatureFlagContract"
)(
  (
    options: GeneratePostHogFeatureFlagContractOptions
  ): Effect.Effect<PostHogFeatureFlagSyncResult, PostHogFeatureFlagError> => {
    return loadPostHogFeatureFlagDefinitions(options).pipe(
      Effect.flatMap((definitions) =>
        generatePostHogFeatureFlagContractFromDefinitions({
          definitions,
          outputFile: options.outputFile,
        })
      )
    );
  }
);

export const generatePostHogFeatureFlagContractFromDefinitions = Effect.fn(
  "generatePostHogFeatureFlagContractFromDefinitions"
)(
  (
    options: GeneratePostHogFeatureFlagContractFromDefinitionsOptions
  ): Effect.Effect<PostHogFeatureFlagSyncResult, PostHogFeatureFlagError> =>
    runPostHogFeatureFlagContractGeneration({
      definitions: Effect.succeed(options.definitions),
      outputFile: options.outputFile,
    })
);

const runPostHogFeatureFlagContractGeneration = ({
  definitions,
  outputFile,
}: {
  readonly definitions: Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >;
  readonly outputFile: string | URL;
}) => {
  const featureFlagSyncLive = PostHogFeatureFlagSync.Default.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(PostHogFeatureFlagService, {
          listDefinitions: definitions,
        }),
        PostHogFeatureFlagContractFile.from(outputFile)
      )
    )
  );

  return runPostHogFeatureFlagSync.pipe(Effect.provide(featureFlagSyncLive));
};

export type { PostHogFeatureFlagDefinition } from "./definitions";
export { PostHogFeatureFlagError } from "./errors";
export type { PostHogFeatureFlagSyncResult } from "./sync";
