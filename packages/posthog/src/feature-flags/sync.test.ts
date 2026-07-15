import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { IPostHogFeatureFlagContractFile } from "./sync";
import { syncPostHogFeatureFlagContract } from "./sync";

describe("syncPostHogFeatureFlagContract", () => {
  test("writes a changed contract", async () => {
    let written: string | undefined;
    const contractFile: IPostHogFeatureFlagContractFile = {
      path: "generated.ts",
      read: Effect.succeed("old"),
      write: (content) =>
        Effect.sync(() => {
          written = content;
        }),
    };

    const result = await Effect.runPromise(
      syncPostHogFeatureFlagContract({
        contractFile,
        definitions: Effect.succeed([
          { key: "meeting_room_page", payloads: {}, variants: [] },
        ]),
      })
    );

    expect(result).toEqual({ flagCount: 1, status: "updated" });
    expect(written).toContain('"meeting_room_page"');
  });

  test("does not rewrite an unchanged contract", async () => {
    let writes = 0;
    let content = "";
    const contractFile: IPostHogFeatureFlagContractFile = {
      path: "generated.ts",
      read: Effect.sync(() => content || undefined),
      write: (nextContent) =>
        Effect.sync(() => {
          writes += 1;
          content = nextContent;
        }),
    };
    const definitions = Effect.succeed([
      { key: "meeting_room_page", payloads: {}, variants: [] },
    ]);

    await Effect.runPromise(
      syncPostHogFeatureFlagContract({
        contractFile,
        definitions,
      })
    );
    const result = await Effect.runPromise(
      syncPostHogFeatureFlagContract({ contractFile, definitions })
    );

    expect(result).toEqual({ flagCount: 1, status: "unchanged" });
    expect(writes).toBe(1);
  });
});
