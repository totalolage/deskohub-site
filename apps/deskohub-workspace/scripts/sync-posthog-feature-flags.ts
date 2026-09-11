import {
  generatePostHogFeatureFlagContract,
  generatePostHogFeatureFlagContractFromDefinitions,
  PostHogFeatureFlagError,
  type PostHogFeatureFlagSyncResult,
} from "@deskohub/posthog/feature-flags/codegen";
import { listPostHogFeatureFlagDefinitions } from "@deskohub/posthog/feature-flags/management";
import { PostHogProjectId } from "@deskohub/posthog/identifiers";
import { Effect, Schema } from "effect";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";

const outputFile = new URL(
  "../features/feature-flags/generated/contract.ts",
  import.meta.url
);
const workspacePostHogProjectId = PostHogProjectId.make("204184");
const workspaceAccountsFeatureFlagId = 274447;

const PostHogFeatureFlagGenerationEnv = Schema.Struct({
  POSTHOG_API_KEY: Schema.NonEmptyString,
  POSTHOG_API_HOST: Schema.URLFromString,
  POSTHOG_PROJECT_ID: PostHogProjectId,
});

const loadPostHogFeatureFlagGenerationEnv = () =>
  Schema.decodeUnknownEffect(PostHogFeatureFlagGenerationEnv)({
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    POSTHOG_API_HOST: process.env.POSTHOG_API_HOST,
    POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new PostHogFeatureFlagError({
          message:
            "Invalid Workspace PostHog feature flag generation environment.",
          cause,
        })
    )
  );

const syncPostHogFeatureFlags = () =>
  Effect.gen(function* () {
    const env = yield* loadPostHogFeatureFlagGenerationEnv();
    const result = yield* generatePostHogFeatureFlagContract({
      apiKey: env.POSTHOG_API_KEY,
      host: env.POSTHOG_API_HOST,
      outputFile,
      projectId: env.POSTHOG_PROJECT_ID,
    });

    yield* Effect.logInfo("Workspace PostHog feature flags synchronized", {
      flagCount: result.flagCount,
      status: result.status,
    });

    return result;
  });

const PostHogCliProject = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
});

const PostHogCliFeatureFlagSummary = Schema.Struct({
  id: Schema.Int,
  key: Schema.String,
});

const PostHogCliFeatureFlagPage = Schema.Struct({
  count: Schema.Int,
  results: Schema.Array(PostHogCliFeatureFlagSummary),
});

const PostHogCliFeatureFlagDefinition = Schema.Struct({
  id: Schema.Int,
  key: Schema.String,
  filters: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  active: Schema.optionalKey(Schema.Boolean),
  archived: Schema.optionalKey(Schema.Boolean),
  deleted: Schema.optionalKey(Schema.Boolean),
  ensure_experience_continuity: Schema.optionalKey(
    Schema.Union([Schema.Boolean, Schema.Null])
  ),
});

const PostHogFeatureFlagCliEnv = Schema.Struct({
  POSTHOG_PROJECT_ID: PostHogProjectId,
});

const loadPostHogFeatureFlagCliEnv = () =>
  Schema.decodeUnknownEffect(PostHogFeatureFlagCliEnv)({
    POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new PostHogFeatureFlagError({
          message: "Invalid Workspace PostHog feature flag CLI environment.",
          cause,
        })
    )
  );

export type PostHogCliInput = {
  readonly "project-get": { readonly id: PostHogProjectId };
  readonly "feature-flag-get-all": {
    readonly limit: number;
    readonly offset: number;
  };
  readonly "feature-flag-get-definition": { readonly id: number };
};

export type PostHogCliOperation = keyof PostHogCliInput;

export type ReadPostHogCliJson = <Operation extends PostHogCliOperation>(
  operation: Operation,
  input: PostHogCliInput[Operation]
) => Effect.Effect<unknown, PostHogFeatureFlagError>;

const readPostHogCliJson: ReadPostHogCliJson = (operation, input) =>
  Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn(
        [
          "posthog-cli",
          "api",
          "call",
          "--json",
          operation,
          JSON.stringify(input),
        ],
        { stderr: "pipe", stdout: "pipe" }
      );
      const [stdout, _stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      if (exitCode !== 0) {
        throw new Error(`PostHog CLI exited with status ${exitCode}.`);
      }

      return JSON.parse(stdout) as unknown;
    },
    catch: () =>
      new PostHogFeatureFlagError({
        message: `Could not read PostHog ${operation} data through the CLI.`,
      }),
  });

const loadPostHogCliProject = (
  projectId: PostHogProjectId,
  readCliJson: ReadPostHogCliJson
) =>
  readCliJson("project-get", { id: projectId }).pipe(
    Effect.flatMap((response) =>
      Schema.decodeUnknownEffect(PostHogCliProject)(response)
    ),
    Effect.mapError(
      () =>
        new PostHogFeatureFlagError({
          message: "Invalid PostHog project response from the CLI.",
        })
    )
  );

const loadPostHogCliFeatureFlagPage = (
  offset: number,
  readCliJson: ReadPostHogCliJson
): Effect.Effect<
  typeof PostHogCliFeatureFlagPage.Type,
  PostHogFeatureFlagError
> =>
  readCliJson("feature-flag-get-all", {
    limit: 100,
    offset,
  }).pipe(
    Effect.flatMap((response) =>
      Schema.decodeUnknownEffect(PostHogCliFeatureFlagPage)(response)
    ),
    Effect.mapError(
      () =>
        new PostHogFeatureFlagError({
          message: "Invalid PostHog feature flag list response from the CLI.",
        })
    )
  );

const loadPostHogCliFeatureFlagDefinition = (
  id: number,
  readCliJson: ReadPostHogCliJson
) =>
  readCliJson("feature-flag-get-definition", { id }).pipe(
    Effect.flatMap((response) =>
      Schema.decodeUnknownEffect(PostHogCliFeatureFlagDefinition)(response)
    ),
    Effect.mapError(
      () =>
        new PostHogFeatureFlagError({
          message: "Invalid PostHog feature flag response from the CLI.",
        })
    )
  );

const loadPostHogFeatureFlagDefinitionsFromCli = ({
  projectId,
  readCliJson,
}: {
  readonly projectId: PostHogProjectId;
  readonly readCliJson: ReadPostHogCliJson;
}) =>
  Effect.gen(function* () {
    const project = yield* loadPostHogCliProject(projectId, readCliJson);

    if (
      projectId !== workspacePostHogProjectId ||
      String(project.id) !== workspacePostHogProjectId ||
      project.name !== "Deskohub Workspace"
    ) {
      return yield* new PostHogFeatureFlagError({
        message:
          "The PostHog CLI is not pointed at the Deskohub Workspace project 204184.",
      });
    }

    const summaries: Array<typeof PostHogCliFeatureFlagSummary.Type> = [];
    let totalCount: number | undefined;
    for (let offset = 0; ; ) {
      const page = yield* loadPostHogCliFeatureFlagPage(offset, readCliJson);
      if (totalCount === undefined) totalCount = page.count;
      if (page.count !== totalCount) {
        return yield* new PostHogFeatureFlagError({
          message: "PostHog CLI returned inconsistent feature flag counts.",
        });
      }
      if (summaries.length + page.results.length > page.count) {
        return yield* new PostHogFeatureFlagError({
          message: "PostHog CLI returned too many feature flags.",
        });
      }

      summaries.push(...page.results);
      if (summaries.length === page.count) break;
      if (page.results.length === 0) {
        return yield* new PostHogFeatureFlagError({
          message: "PostHog CLI returned an incomplete feature flag list.",
        });
      }
      offset += page.results.length;
    }

    const definitions: Array<typeof PostHogCliFeatureFlagDefinition.Type> = [];
    for (const summary of summaries) {
      const definition = yield* loadPostHogCliFeatureFlagDefinition(
        summary.id,
        readCliJson
      );
      if (definition.id !== summary.id || definition.key !== summary.key) {
        return yield* new PostHogFeatureFlagError({
          message: "PostHog CLI returned a mismatched feature flag definition.",
        });
      }
      definitions.push(definition);
    }

    const accountsDefinition = definitions.find(
      ({ id, key }) =>
        id === workspaceAccountsFeatureFlagId && key === "accounts"
    );
    if (
      accountsDefinition?.active !== false ||
      accountsDefinition.archived === true ||
      accountsDefinition.deleted === true
    ) {
      return yield* new PostHogFeatureFlagError({
        message:
          "The existing Workspace accounts feature flag must remain present and inactive.",
      });
    }

    return yield* listPostHogFeatureFlagDefinitions(projectId, () =>
      Effect.succeed({
        count: definitions.length,
        results: definitions,
      })
    );
  });

export interface SyncPostHogFeatureFlagsFromCliOptions {
  readonly projectId: PostHogProjectId;
  readonly outputFile: string | URL;
  readonly readCliJson?: ReadPostHogCliJson;
}

export const syncPostHogFeatureFlagsFromCli = ({
  projectId,
  outputFile,
  readCliJson = readPostHogCliJson,
}: SyncPostHogFeatureFlagsFromCliOptions): Effect.Effect<
  PostHogFeatureFlagSyncResult,
  PostHogFeatureFlagError
> =>
  Effect.gen(function* () {
    const definitions = yield* loadPostHogFeatureFlagDefinitionsFromCli({
      projectId,
      readCliJson,
    });
    const result = yield* generatePostHogFeatureFlagContractFromDefinitions({
      definitions,
      outputFile,
    });

    yield* Effect.logInfo("Workspace PostHog feature flags synchronized", {
      flagCount: result.flagCount,
      status: result.status,
    });

    return result;
  });

if (import.meta.main) {
  const sync = process.argv.includes("--cli")
    ? loadPostHogFeatureFlagCliEnv().pipe(
        Effect.flatMap(({ POSTHOG_PROJECT_ID: projectId }) =>
          syncPostHogFeatureFlagsFromCli({ projectId, outputFile })
        )
      )
    : syncPostHogFeatureFlags();

  await sync.pipe(runStandaloneWorkspaceEffect("feature-flags.sync"));
}
