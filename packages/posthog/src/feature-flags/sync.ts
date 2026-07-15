import { Context, Effect, Layer } from "effect";
import {
  type PostHogFeatureFlagDefinition,
  PostHogFeatureFlagService,
} from "./definitions";
import { PostHogFeatureFlagError } from "./errors";
import { renderPostHogFeatureFlagContract } from "./render";

const generatedContractPath = Bun.fileURLToPath(
  new URL("../generated/feature-flags.ts", import.meta.url)
);

export type PostHogFeatureFlagSyncMode = "check" | "sync";

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
  static Live = Layer.succeed(this, {
    path: generatedContractPath,
    read: readPostHogFeatureFlagContract(generatedContractPath),
    write: (content) =>
      writePostHogFeatureFlagContract(generatedContractPath, content),
  });
}

interface IPostHogFeatureFlagSync {
  readonly run: (
    mode: PostHogFeatureFlagSyncMode
  ) => Effect.Effect<PostHogFeatureFlagSyncResult, PostHogFeatureFlagError>;
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
        run: (mode) =>
          syncPostHogFeatureFlagContract({
            contractFile,
            definitions: featureFlags.listDefinitions(),
            mode,
          }),
      } satisfies IPostHogFeatureFlagSync;
    })
  );
}

export const runPostHogFeatureFlagSync = (mode: PostHogFeatureFlagSyncMode) =>
  Effect.gen(function* () {
    const sync = yield* PostHogFeatureFlagSync;
    return yield* sync.run(mode);
  });

export const syncPostHogFeatureFlagContract = ({
  contractFile,
  definitions,
  mode,
}: {
  readonly contractFile: IPostHogFeatureFlagContractFile;
  readonly definitions: Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >;
  readonly mode: PostHogFeatureFlagSyncMode;
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

    if (mode === "check") {
      return yield* new PostHogFeatureFlagError({
        message:
          "PostHog feature flag types are out of date. Run `bun run feature-flags:sync` in `@deskohub/posthog`.",
      });
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
