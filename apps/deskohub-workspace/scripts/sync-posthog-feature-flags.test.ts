import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostHogFeatureFlagError } from "@deskohub/posthog/feature-flags/codegen";
import { PostHogProjectId } from "@deskohub/posthog/identifiers";
import { Cause, Effect, Exit, Option } from "effect";
import type {
  PostHogCliInput,
  PostHogCliOperation,
  ReadPostHogCliJson,
} from "./sync-posthog-feature-flags";
import { syncPostHogFeatureFlagsFromCli } from "./sync-posthog-feature-flags";

const projectId = PostHogProjectId.make("204184");
const workspaceProject = { id: 204184, name: "Deskohub Workspace" };
const accountsSummary = { id: 274447, key: "accounts" };
const accountsDefinition = {
  ...accountsSummary,
  active: false,
  filters: {},
};
const existingContract = "// contract from before this sync\n";

type CliFixtureResponse =
  | { readonly id: number; readonly name: string }
  | {
      readonly count: number;
      readonly results: readonly {
        readonly id?: number;
        readonly key?: string;
      }[];
    }
  | {
      readonly id: number;
      readonly key: string;
      readonly filters?: Readonly<Record<string, never>>;
      readonly active?: boolean;
      readonly archived?: boolean;
      readonly deleted?: boolean;
      readonly ensure_experience_continuity?: boolean | null;
    }
  | undefined;

type CliCall = {
  readonly operation: PostHogCliOperation;
  readonly input: PostHogCliInput[PostHogCliOperation];
};

const makeReader = (
  respond: (
    operation: PostHogCliOperation
  ) => Effect.Effect<unknown, PostHogFeatureFlagError>
) => {
  const calls: CliCall[] = [];
  const readCliJson: ReadPostHogCliJson = (operation, input) => {
    calls.push({ operation, input });
    return respond(operation);
  };

  return { calls, readCliJson };
};

const makeQueuedReader = ({
  project = workspaceProject,
  pages,
  definitions,
}: {
  readonly project?: CliFixtureResponse;
  readonly pages: readonly CliFixtureResponse[];
  readonly definitions: readonly CliFixtureResponse[];
}) => {
  let pageIndex = 0;
  let definitionIndex = 0;

  return makeReader((operation) => {
    switch (operation) {
      case "project-get":
        return Effect.succeed(project);
      case "feature-flag-get-all":
        return Effect.succeed(pages[pageIndex++]);
      case "feature-flag-get-definition":
        return Effect.succeed(definitions[definitionIndex++]);
    }
  });
};

const withTempOutput = async (run: (outputFile: string) => Promise<void>) => {
  const directory = mkdtempSync(join(tmpdir(), "deskohub-posthog-sync-"));
  const outputFile = join(directory, "contract.ts");

  try {
    await run(outputFile);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

const runFailure = async (
  effect: Effect.Effect<unknown, PostHogFeatureFlagError>
) => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected the feature flag sync to fail.");
  }

  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isNone(failure)) {
    throw new Error("Expected a typed feature flag sync failure.");
  }
  expect(failure.value).toBeInstanceOf(PostHogFeatureFlagError);
  return failure.value;
};

describe("Workspace PostHog feature flag CLI synchronization", () => {
  test("writes the boolean contract through the CLI without a management API key", async () => {
    const previousApiKey = process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_API_KEY;

    try {
      await withTempOutput(async (outputFile) => {
        writeFileSync(outputFile, existingContract);
        const reader = makeQueuedReader({
          pages: [{ count: 1, results: [accountsSummary] }],
          definitions: [accountsDefinition],
        });

        const result = await Effect.runPromise(
          syncPostHogFeatureFlagsFromCli({
            outputFile,
            projectId,
            readCliJson: reader.readCliJson,
          })
        );
        const contract = await Bun.file(outputFile).text();

        expect(result).toEqual({ flagCount: 1, status: "updated" });
        expect(contract).toContain('  "accounts",');
        expect(contract).toContain("readonly value: boolean;");
        expect(reader.calls).toEqual([
          { operation: "project-get", input: { id: projectId } },
          {
            operation: "feature-flag-get-all",
            input: { limit: 100, offset: 0 },
          },
          {
            operation: "feature-flag-get-definition",
            input: { id: 274447 },
          },
        ]);
      });
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.POSTHOG_API_KEY;
      } else {
        process.env.POSTHOG_API_KEY = previousApiKey;
      }
    }
  });

  test("paginates every CLI flag before generating the contract", async () => {
    await withTempOutput(async (outputFile) => {
      const secondSummary = { id: 12, key: "calendar_sales" };
      const reader = makeQueuedReader({
        pages: [
          { count: 2, results: [accountsSummary] },
          { count: 2, results: [secondSummary] },
        ],
        definitions: [
          accountsDefinition,
          { ...secondSummary, active: false, filters: {} },
        ],
      });

      await Effect.runPromise(
        syncPostHogFeatureFlagsFromCli({
          outputFile,
          projectId,
          readCliJson: reader.readCliJson,
        })
      );

      const contract = await Bun.file(outputFile).text();
      expect(contract).toContain('  "accounts",');
      expect(contract).toContain('  "calendar_sales",');
      expect(reader.calls).toEqual([
        { operation: "project-get", input: { id: projectId } },
        {
          operation: "feature-flag-get-all",
          input: { limit: 100, offset: 0 },
        },
        {
          operation: "feature-flag-get-all",
          input: { limit: 100, offset: 1 },
        },
        {
          operation: "feature-flag-get-definition",
          input: { id: 274447 },
        },
        {
          operation: "feature-flag-get-definition",
          input: { id: 12 },
        },
      ]);
      expect(
        reader.calls.every(({ operation }) =>
          [
            "project-get",
            "feature-flag-get-all",
            "feature-flag-get-definition",
          ].includes(operation)
        )
      ).toBe(true);
    });
  });

  const invalidCliFixtures: readonly {
    readonly name: string;
    readonly project: CliFixtureResponse;
    readonly pages: readonly CliFixtureResponse[];
    readonly definitions: readonly CliFixtureResponse[];
  }[] = [
    {
      name: "a different project",
      project: { id: 204185, name: "Another Project" },
      pages: [],
      definitions: [],
    },
    {
      name: "a missing accounts flag",
      project: workspaceProject,
      pages: [{ count: 0, results: [] }],
      definitions: [],
    },
    {
      name: "a flag with the wrong identity",
      project: workspaceProject,
      pages: [{ count: 1, results: [{ id: 274448, key: "not_accounts" }] }],
      definitions: [
        { id: 274448, key: "not_accounts", active: false, filters: {} },
      ],
    },
    {
      name: "the accounts ID with the wrong key",
      project: workspaceProject,
      pages: [{ count: 1, results: [{ id: 274447, key: "not_accounts" }] }],
      definitions: [
        { id: 274447, key: "not_accounts", active: false, filters: {} },
      ],
    },
    {
      name: "an active accounts flag",
      project: workspaceProject,
      pages: [{ count: 1, results: [accountsSummary] }],
      definitions: [{ ...accountsDefinition, active: true }],
    },
    {
      name: "an archived accounts flag",
      project: workspaceProject,
      pages: [{ count: 1, results: [accountsSummary] }],
      definitions: [{ ...accountsDefinition, archived: true }],
    },
    {
      name: "a deleted accounts flag",
      project: workspaceProject,
      pages: [{ count: 1, results: [accountsSummary] }],
      definitions: [{ ...accountsDefinition, deleted: true }],
    },
  ];

  for (const fixture of invalidCliFixtures) {
    test(`rejects ${fixture.name} without overwriting the contract`, async () => {
      await withTempOutput(async (outputFile) => {
        writeFileSync(outputFile, existingContract);
        const reader = makeQueuedReader(fixture);

        const error = await runFailure(
          syncPostHogFeatureFlagsFromCli({
            outputFile,
            projectId,
            readCliJson: reader.readCliJson,
          })
        );

        expect(error.cause).toBeUndefined();
        expect(await Bun.file(outputFile).text()).toBe(existingContract);
      });
    });
  }

  test("rejects malformed CLI data without retaining its payload", async () => {
    await withTempOutput(async (outputFile) => {
      writeFileSync(outputFile, existingContract);
      const reader = makeQueuedReader({
        pages: [{ count: 1, results: [{ id: 274447 }] }],
        definitions: [],
      });

      const error = await runFailure(
        syncPostHogFeatureFlagsFromCli({
          outputFile,
          projectId,
          readCliJson: reader.readCliJson,
        })
      );

      expect(error.cause).toBeUndefined();
      expect(await Bun.file(outputFile).text()).toBe(existingContract);
    });
  });

  test("rejects a failed CLI operation without overwriting the contract", async () => {
    await withTempOutput(async (outputFile) => {
      writeFileSync(outputFile, existingContract);
      const reader = makeReader((operation) =>
        operation === "feature-flag-get-all"
          ? Effect.fail(
              new PostHogFeatureFlagError({ message: "synthetic CLI failure" })
            )
          : Effect.succeed(workspaceProject)
      );

      const error = await runFailure(
        syncPostHogFeatureFlagsFromCli({
          outputFile,
          projectId,
          readCliJson: reader.readCliJson,
        })
      );

      expect(error.cause).toBeUndefined();
      expect(await Bun.file(outputFile).text()).toBe(existingContract);
    });
  });
});
