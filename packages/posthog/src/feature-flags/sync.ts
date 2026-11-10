import { Clock, Context, Effect, Layer } from "effect";
import {
  type PostHogFeatureFlagDefinition,
  PostHogFeatureFlagService,
} from "./definitions";
import { PostHogFeatureFlagError } from "./errors";
import {
  renderPostHogFeatureFlagContract,
  renderPostHogFeatureFlagSnapshot,
} from "./render";

export interface PostHogFeatureFlagSyncResult {
  readonly flagCount: number;
  /** Whether the contract changed; the snapshot is rewritten every time. */
  readonly status: "unchanged" | "updated";
}

/** A generated source file: the flag contract or its definitions snapshot. */
export interface IPostHogFeatureFlagGeneratedFile {
  readonly path: string;
  readonly read: Effect.Effect<string | undefined, PostHogFeatureFlagError>;
  readonly write: (
    content: string
  ) => Effect.Effect<void, PostHogFeatureFlagError>;
}

export class PostHogFeatureFlagContractFile extends Context.Service<
  PostHogFeatureFlagContractFile,
  IPostHogFeatureFlagGeneratedFile
>()("@deskohub/posthog/PostHogFeatureFlagContractFile") {
  static from = (outputFile: string | URL) =>
    Layer.succeed(this, makeGeneratedFile(outputFile));
}

export class PostHogFeatureFlagSnapshotFile extends Context.Service<
  PostHogFeatureFlagSnapshotFile,
  IPostHogFeatureFlagGeneratedFile
>()("@deskohub/posthog/PostHogFeatureFlagSnapshotFile") {
  static from = (outputFile: string | URL) =>
    Layer.succeed(this, makeGeneratedFile(outputFile));
}

const makeGeneratedFile = (
  outputFile: string | URL
): IPostHogFeatureFlagGeneratedFile => {
  const path =
    typeof outputFile === "string" ? outputFile : Bun.fileURLToPath(outputFile);

  return {
    path,
    read: readGeneratedFile(path),
    write: (content) => writeGeneratedFile(path, content),
  };
};

interface IPostHogFeatureFlagSync {
  readonly run: Effect.Effect<
    PostHogFeatureFlagSyncResult,
    PostHogFeatureFlagError
  >;
}

export class PostHogFeatureFlagSync extends Context.Service<
  PostHogFeatureFlagSync,
  IPostHogFeatureFlagSync
>()("@deskohub/posthog/PostHogFeatureFlagSync") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* PostHogFeatureFlagService;
      const contractFile = yield* PostHogFeatureFlagContractFile;
      const snapshotFile = yield* PostHogFeatureFlagSnapshotFile;

      return {
        run: syncPostHogFeatureFlagContract({
          contractFile,
          definitions: featureFlags.listDefinitions,
          snapshotFile,
        }),
      } satisfies IPostHogFeatureFlagSync;
    })
  );
}

export const runPostHogFeatureFlagSync = Effect.gen(function* () {
  const sync = yield* PostHogFeatureFlagSync;
  return yield* sync.run;
});

/** Writes the contract when it changed and the snapshot every time. */
export const syncPostHogFeatureFlagContract = ({
  contractFile,
  definitions,
  snapshotFile,
}: {
  readonly contractFile: IPostHogFeatureFlagGeneratedFile;
  readonly definitions: Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >;
  readonly snapshotFile: IPostHogFeatureFlagGeneratedFile;
}) =>
  Effect.gen(function* () {
    const featureFlags = yield* definitions;
    const content = yield* renderPostHogFeatureFlagContract(featureFlags);
    const snapshot = yield* renderSnapshot(
      featureFlags,
      featureFlags.map(({ key }) => key)
    );
    const existingContent = yield* contractFile.read;
    const status =
      existingContent === content
        ? ("unchanged" as const)
        : ("updated" as const);

    if (status === "updated") yield* contractFile.write(content);
    yield* snapshotFile.write(snapshot);

    return { flagCount: featureFlags.length, status };
  });

/**
 * Rewrites only the snapshot, for the keys of a contract that stays as it
 * is, such as the committed one during a build.
 */
export const refreshPostHogFeatureFlagSnapshot = ({
  definitions,
  keys,
  snapshotFile,
}: {
  readonly definitions: Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >;
  readonly keys: readonly string[];
  readonly snapshotFile: IPostHogFeatureFlagGeneratedFile;
}) =>
  Effect.gen(function* () {
    const snapshot = yield* renderSnapshot(yield* definitions, keys);
    yield* snapshotFile.write(snapshot);
    return { flagCount: keys.length };
  });

const renderSnapshot = (
  definitions: readonly PostHogFeatureFlagDefinition[],
  keys: readonly string[]
) =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      renderPostHogFeatureFlagSnapshot({
        definitions,
        generatedAt: new Date(now),
        keys,
      })
    )
  );

function readGeneratedFile(path: string) {
  return Effect.tryPromise({
    try: async () => {
      const file = Bun.file(path);
      return (await file.exists()) ? await file.text() : undefined;
    },
    catch: (cause) =>
      new PostHogFeatureFlagError({
        message: `Could not read the generated feature flag file ${path}.`,
        cause,
      }),
  });
}

function writeGeneratedFile(path: string, content: string) {
  return Effect.tryPromise({
    try: () => Bun.write(path, content),
    catch: (cause) =>
      new PostHogFeatureFlagError({
        message: `Could not write the generated feature flag file ${path}.`,
        cause,
      }),
  }).pipe(Effect.asVoid);
}
