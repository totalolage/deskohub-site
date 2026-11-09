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
  PostHogFeatureFlagSnapshotFile,
  PostHogFeatureFlagSync,
  type PostHogFeatureFlagSyncResult,
  refreshPostHogFeatureFlagSnapshot,
  runPostHogFeatureFlagSync,
} from "./sync";

interface PostHogFeatureFlagManagementOptions {
  readonly apiKey: string;
  readonly host: URL;
  readonly projectId: PostHogProjectId;
}

interface PostHogFeatureFlagOutputFiles {
  readonly outputFile: string | URL;
  /** Where the definitions snapshot (`PostHogFeatureFlagSnapshot`) goes. */
  readonly snapshotFile: string | URL;
}

export interface GeneratePostHogFeatureFlagContractOptions
  extends PostHogFeatureFlagManagementOptions,
    PostHogFeatureFlagOutputFiles {}

export interface GeneratePostHogFeatureFlagContractFromDefinitionsOptions
  extends PostHogFeatureFlagOutputFiles {
  readonly definitions: readonly PostHogFeatureFlagDefinition[];
}

export interface GeneratePostHogFeatureFlagSnapshotOptions
  extends PostHogFeatureFlagManagementOptions {
  /** The keys of the contract the snapshot belongs to. */
  readonly keys: readonly string[];
  readonly snapshotFile: string | URL;
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
          snapshotFile: options.snapshotFile,
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
      snapshotFile: options.snapshotFile,
    })
);

/**
 * Rewrites only the definitions snapshot of an existing contract's `keys`,
 * leaving the contract itself as it is.
 */
export const generatePostHogFeatureFlagSnapshot = Effect.fn(
  "generatePostHogFeatureFlagSnapshot"
)(
  (
    options: GeneratePostHogFeatureFlagSnapshotOptions
  ): Effect.Effect<{ readonly flagCount: number }, PostHogFeatureFlagError> =>
    Effect.gen(function* () {
      const snapshotFile = yield* PostHogFeatureFlagSnapshotFile;
      return yield* refreshPostHogFeatureFlagSnapshot({
        definitions: loadPostHogFeatureFlagDefinitions(options),
        keys: options.keys,
        snapshotFile,
      });
    }).pipe(
      Effect.provide(PostHogFeatureFlagSnapshotFile.from(options.snapshotFile))
    )
);

const runPostHogFeatureFlagContractGeneration = ({
  definitions,
  outputFile,
  snapshotFile,
}: PostHogFeatureFlagOutputFiles & {
  readonly definitions: Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >;
}) => {
  const featureFlagSyncLive = PostHogFeatureFlagSync.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(PostHogFeatureFlagService, {
          listDefinitions: definitions,
        }),
        PostHogFeatureFlagContractFile.from(outputFile),
        PostHogFeatureFlagSnapshotFile.from(snapshotFile)
      )
    )
  );

  return runPostHogFeatureFlagSync.pipe(Effect.provide(featureFlagSyncLive));
};

export type { PostHogFeatureFlagDefinition } from "./definitions";
export { PostHogFeatureFlagError } from "./errors";
export type { PostHogFeatureFlagSyncResult } from "./sync";
