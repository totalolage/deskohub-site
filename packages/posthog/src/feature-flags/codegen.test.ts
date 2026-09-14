import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { PostHogProjectId } from "../identifiers";
import {
  generatePostHogFeatureFlagContract,
  generatePostHogFeatureFlagContractFromDefinitions,
} from "./codegen";
import type { PostHogFeatureFlagDefinition } from "./definitions";

const definitions: readonly PostHogFeatureFlagDefinition[] = [
  {
    key: "feature_b",
    payloads: {
      control: '{"privateValue":"must-not-be-generated"}',
    },
    variants: ["control"],
  },
  { key: "feature_a", payloads: {}, variants: [] },
];

const projectId = PostHogProjectId.make("project");

describe("generatePostHogFeatureFlagContractFromDefinitions", () => {
  test("uses the same output path as HTTP generation", async () => {
    const httpDefinitions = [...definitions].reverse();
    const fetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          JSON.stringify({
            count: httpDefinitions.length,
            next: null,
            previous: null,
            results: httpDefinitions.map((definition, index) =>
              makeFeatureFlagResponse(definition, index + 1)
            ),
          }),
          { headers: { "content-type": "application/json" } }
        ),
      { preconnect: fetch.preconnect }
    );

    try {
      await withOutputFiles(async (directOutputFile, httpOutputFile) => {
        await Effect.runPromise(
          generatePostHogFeatureFlagContractFromDefinitions({
            definitions: httpDefinitions,
            outputFile: directOutputFile,
          })
        );
        await Effect.runPromise(
          generatePostHogFeatureFlagContract({
            apiKey: "synthetic-api-key",
            host: new URL("https://posthog.example"),
            outputFile: httpOutputFile,
            projectId,
          })
        );

        expect(await Bun.file(directOutputFile).text()).toBe(
          await Bun.file(httpOutputFile).text()
        );
      });
    } finally {
      globalThis.fetch = fetch;
    }
  });

  test("reports render errors through the Effect error channel", async () => {
    await withOutputFiles(async (outputFile) => {
      const result = await Effect.runPromiseExit(
        generatePostHogFeatureFlagContractFromDefinitions({
          definitions: [
            { key: "duplicate", payloads: {}, variants: [] },
            { key: "duplicate", payloads: {}, variants: [] },
          ],
          outputFile,
        })
      );

      expect(result._tag).toBe("Failure");
      expect(await Bun.file(outputFile).exists()).toBeFalse();
    });
  });

  test("generates payload shapes without configured payload values", async () => {
    await withOutputFiles(async (outputFile) => {
      await Effect.runPromise(
        generatePostHogFeatureFlagContractFromDefinitions({
          definitions: [
            {
              key: "private_payload",
              payloads: {
                control: '{"apiKey":"must-not-be-generated"}',
              },
              variants: ["control"],
            },
          ],
          outputFile,
        })
      );

      const content = await Bun.file(outputFile).text();
      expect(content).toContain('readonly "apiKey": string;');
      expect(content).not.toContain("must-not-be-generated");
    });
  });
});

const withOutputFiles = async (
  callback: (directOutputFile: string, httpOutputFile: string) => Promise<void>
) => {
  const directory = mkdtempSync(join(tmpdir(), "posthog-feature-flags-"));

  try {
    await callback(
      join(directory, "direct-contract.ts"),
      join(directory, "http-contract.ts")
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

const makeFeatureFlagResponse = (
  definition: PostHogFeatureFlagDefinition,
  id: number
) => ({
  id,
  key: definition.key,
  filters: {
    aggregation_group_type_index: null,
    groups: [
      {
        aggregation_group_type_index: null,
        properties: [],
        rollout_percentage: 100,
      },
    ],
    multivariate:
      definition.variants.length > 0
        ? { variants: definition.variants.map((key) => ({ key })) }
        : null,
    payloads: definition.payloads,
  },
  active: true,
  archived: false,
  deleted: false,
  created_by: {
    id: 1,
    uuid: "00000000-0000-4000-8000-000000000001",
    email: "synthetic@example.com",
    hedgehog_config: null,
  },
  updated_at: "2026-01-01T00:00:00Z",
  last_modified_by: {
    id: 1,
    uuid: "00000000-0000-4000-8000-000000000001",
    email: "synthetic@example.com",
    hedgehog_config: null,
  },
  ensure_experience_continuity: false,
  experiment_set: [],
  experiment_set_metadata: [],
  surveys: null,
  features: [],
  can_edit: true,
  usage_dashboard: 0,
  user_access_level: null,
  status: "ACTIVE",
  is_used_in_replay_settings: false,
  is_eligible_for_experiment: false,
});
