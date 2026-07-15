import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { IPostHogFeatureFlagContractFile } from "./sync";
import { syncPostHogFeatureFlagContract } from "./sync";

describe("syncPostHogFeatureFlagContract", () => {
  test("writes a changed contract in sync mode", async () => {
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
        mode: "sync",
      })
    );

    expect(result).toEqual({ flagCount: 1, status: "updated" });
    expect(written).toContain('"meeting_room_page"');
  });

  test("fails instead of writing a changed contract in check mode", async () => {
    let wrote = false;
    const result = await Effect.runPromiseExit(
      syncPostHogFeatureFlagContract({
        contractFile: {
          path: "generated.ts",
          read: Effect.succeed("old"),
          write: () =>
            Effect.sync(() => {
              wrote = true;
            }),
        },
        definitions: Effect.succeed([
          { key: "meeting_room_page", payloads: {}, variants: [] },
        ]),
        mode: "check",
      })
    );

    expect(result._tag).toBe("Failure");
    expect(wrote).toBeFalse();
  });
});
