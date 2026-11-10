import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { IPostHogFeatureFlagGeneratedFile } from "./sync";
import { syncPostHogFeatureFlagContract } from "./sync";

describe("syncPostHogFeatureFlagContract", () => {
  test("does not rewrite an unchanged contract but refreshes its snapshot", async () => {
    const contractFile = makeGeneratedFile();
    const snapshotFile = makeGeneratedFile();
    const definitions = Effect.succeed([
      { key: "meeting_room_page", payloads: {}, variants: [] },
    ]);

    await Effect.runPromise(
      syncPostHogFeatureFlagContract({
        contractFile,
        definitions,
        snapshotFile,
      })
    );
    const result = await Effect.runPromise(
      syncPostHogFeatureFlagContract({
        contractFile,
        definitions,
        snapshotFile,
      })
    );

    expect(result).toEqual({ flagCount: 1, status: "unchanged" });
    expect(contractFile.writes()).toBe(1);
    expect(snapshotFile.writes()).toBe(2);
  });
});

const makeGeneratedFile = (): IPostHogFeatureFlagGeneratedFile & {
  readonly writes: () => number;
} => {
  let writes = 0;
  let content = "";
  return {
    path: "generated.ts",
    read: Effect.sync(() => content || undefined),
    write: (nextContent) =>
      Effect.sync(() => {
        writes += 1;
        content = nextContent;
      }),
    writes: () => writes,
  };
};
