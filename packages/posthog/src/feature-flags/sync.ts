import { Context, Effect, Layer } from "effect";
import {
  type PostHogFeatureFlagDefinition,
  PostHogFeatureFlagService,
} from "./definitions";
import { PostHogFeatureFlagError } from "./errors";
import { renderPostHogFeatureFlagContract } from "./render";

export interface PostHogFeatureFlagSyncResult {
  readonly flagCount: number;
  readonly status: "unchanged" | "updated";
}

export interface IPostHogFeatureFlagContractFile {
  readonly path: string;
  readonly read: Effect.Effect<string | undefined, PostHogFeatureFlagError>;
  readonly write: (
    content: string
  ) => Effect.Effect<void, PostHogFeatureFlagError>;
}

export class PostHogFeatureFlagContractFile extends Context.Service<
  PostHogFeatureFlagContractFile,
  IPostHogFeatureFlagContractFile
>()("@deskohub/posthog/PostHogFeatureFlagContractFile") {
  static from = (outputFile: string | URL) => {
    const path =
      typeof outputFile === "string"
        ? outputFile
        : Bun.fileURLToPath(outputFile);

    return Layer.succeed(this, {
      path,
      read: readPostHogFeatureFlagContract(path),
      write: (content) => writePostHogFeatureFlagContract(path, content),
    });
  };
}

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
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* PostHogFeatureFlagService;
      const contractFile = yield* PostHogFeatureFlagContractFile;

      return {
        run: syncPostHogFeatureFlagContract({
          contractFile,
          definitions: featureFlags.listDefinitions,
        }),
      } satisfies IPostHogFeatureFlagSync;
    })
  );
}

export const runPostHogFeatureFlagSync = Effect.gen(function* () {
  const sync = yield* PostHogFeatureFlagSync;
  return yield* sync.run;
});

export const syncPostHogFeatureFlagContract = ({
  contractFile,
  definitions,
}: {
  readonly contractFile: IPostHogFeatureFlagContractFile;
  readonly definitions: Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >;
}) =>
  Effect.gen(function* () {
    const featureFlags = yield* definitions;
    const content = yield* renderPostHogFeatureFlagContract(featureFlags);
    const existingContent = yield* contractFile.read;

    if (existingContent === content) {
      return {
        flagCount: featureFlags.length,
        status: "unchanged" as const,
      };
    }

    yield* contractFile.write(content);
    return {
      flagCount: featureFlags.length,
      status: "updated" as const,
    };
  });

function readPostHogFeatureFlagContract(path: string) {
  return Effect.tryPromise({
    try: async () => {
      const file = Bun.file(path);
      return (await file.exists()) ? await file.text() : undefined;
    },
    catch: (cause) =>
      new PostHogFeatureFlagError({
        message: "Could not read the generated feature flag contract.",
        cause,
      }),
  });
}

function writePostHogFeatureFlagContract(path: string, content: string) {
  return Effect.tryPromise({
    try: () => Bun.write(path, content),
    catch: (cause) =>
      new PostHogFeatureFlagError({
        message: "Could not write the generated feature flag contract.",
        cause,
      }),
  }).pipe(Effect.asVoid);
}
