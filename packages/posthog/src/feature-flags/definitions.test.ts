import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { PostHogProjectId } from "../identifiers";
import {
  listPostHogFeatureFlagDefinitions,
  type PostHogFeatureFlagPageSource,
} from "./definitions";

describe("listPostHogFeatureFlagDefinitions", () => {
  const projectId = PostHogProjectId.make("project");

  test("paginates, excludes deleted flags, and normalizes definitions", async () => {
    const calls: number[] = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      key: `flag-${index.toString().padStart(3, "0")}`,
    }));
    const listPage: PostHogFeatureFlagPageSource = ({ offset }) => {
      calls.push(offset);
      return Effect.succeed(
        offset === 0
          ? { count: 102, results: firstPage }
          : {
              count: 102,
              results: [
                {
                  key: "z-variant",
                  filters: {
                    multivariate: {
                      variants: [
                        { key: " treatment " },
                        { key: "control" },
                        { key: "control" },
                      ],
                    },
                    payloads: { treatment: '{"capacity":8}' },
                  },
                },
                { key: "deleted", deleted: true },
              ],
            }
      );
    };

    const definitions = await Effect.runPromise(
      listPostHogFeatureFlagDefinitions(projectId, listPage)
    );

    expect(calls).toEqual([0, 100]);
    expect(definitions).toHaveLength(101);
    expect(definitions.at(-1)).toEqual({
      constantEnabledValue: undefined,
      key: "z-variant",
      payloads: { treatment: '{"capacity":8}' },
      variants: ["control", "treatment"],
    });
  });

  test("classifies only provably constant boolean evaluations", async () => {
    const definitions = await Effect.runPromise(
      listPostHogFeatureFlagDefinitions(projectId, () =>
        Effect.succeed({
          count: 8,
          results: [
            { key: "inactive", active: false },
            {
              key: "off",
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 0 }] },
            },
            {
              key: "on",
              active: true,
              filters: {
                groups: [{ properties: [], rollout_percentage: 100 }],
              },
            },
            {
              key: "partial",
              active: true,
              filters: {
                groups: [{ properties: [], rollout_percentage: 50 }],
              },
            },
            {
              key: "targeted",
              active: true,
              filters: {
                groups: [
                  {
                    properties: [{ key: "plan", value: "paid" }],
                    rollout_percentage: 100,
                  },
                ],
              },
            },
            {
              key: "targeted-then-global",
              active: true,
              filters: {
                groups: [
                  {
                    properties: [{ key: "plan", value: "paid" }],
                    rollout_percentage: 100,
                  },
                  { properties: [], rollout_percentage: 100 },
                ],
              },
            },
            {
              key: "continuity",
              active: true,
              ensure_experience_continuity: true,
              filters: { groups: [{ properties: [], rollout_percentage: 0 }] },
            },
            {
              key: "variant",
              active: true,
              filters: {
                groups: [{ properties: [], rollout_percentage: 100 }],
                multivariate: {
                  variants: [
                    { key: "control" },
                    { key: "treatment" },
                  ],
                },
              },
            },
          ] as const,
        })
      )
    );

    expect(
      Object.fromEntries(
        definitions.map(({ constantEnabledValue, key }) => [
          key,
          constantEnabledValue,
        ])
      )
    ).toEqual({
      continuity: undefined,
      inactive: false,
      off: false,
      on: true,
      partial: undefined,
      targeted: undefined,
      "targeted-then-global": true,
      variant: undefined,
    });
  });

  test("does not classify an active flag without release conditions", async () => {
    const [definition] = await Effect.runPromise(
      listPostHogFeatureFlagDefinitions(projectId, () =>
        Effect.succeed({ count: 1, results: [{ key: "empty", active: true }] })
      )
    );

    expect(definition?.constantEnabledValue).toBeUndefined();
  });

  test("fails through the Effect error channel for duplicate keys", async () => {
    const result = await Effect.runPromiseExit(
      listPostHogFeatureFlagDefinitions(projectId, () =>
        Effect.succeed({
          count: 2,
          results: [{ key: "duplicate" }, { key: "duplicate" }],
        })
      )
    );

    expect(result._tag).toBe("Failure");
  });
});
