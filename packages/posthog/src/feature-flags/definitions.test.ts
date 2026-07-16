import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  listPostHogFeatureFlagDefinitions,
  type PostHogFeatureFlagPageSource,
} from "./definitions";

describe("listPostHogFeatureFlagDefinitions", () => {
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
      listPostHogFeatureFlagDefinitions("project", listPage)
    );

    expect(calls).toEqual([0, 100]);
    expect(definitions).toHaveLength(101);
    expect(definitions.at(-1)).toEqual({
      key: "z-variant",
      payloads: { treatment: '{"capacity":8}' },
      variants: ["control", "treatment"],
    });
  });

  test("fails through the Effect error channel for duplicate keys", async () => {
    const result = await Effect.runPromiseExit(
      listPostHogFeatureFlagDefinitions("project", () =>
        Effect.succeed({
          count: 2,
          results: [{ key: "duplicate" }, { key: "duplicate" }],
        })
      )
    );

    expect(result._tag).toBe("Failure");
  });
});
