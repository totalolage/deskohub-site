import { describe, expect, test } from "bun:test";
import { failedFlagReload, type StoredFlagResponse } from "./flag-reload";

// Shapes as @posthog/core 1.64.1 stores them after a flags response
// (`PostHogFlagsStorageFormat`, posthog-core.ts _flagsAsync).
const stored = (
  record: StoredFlagResponse & {
    readonly flags: Readonly<Record<string, unknown>>;
    readonly requestId?: string;
  }
) => record;

describe("failedFlagReload", () => {
  test("accepts a complete response", () => {
    expect(
      failedFlagReload(
        { seating_map: true },
        stored({ flags: {}, requestId: "r1" })
      )
    ).toBeUndefined();
  });

  test("rejects a failed request, which resolves with no flags", () => {
    expect(failedFlagReload(undefined, stored({ flags: {} }))).toBeString();
  });

  test("rejects a quota-limited response, which keeps the cached flags", () => {
    expect(
      failedFlagReload(
        {},
        stored({ flags: {}, quotaLimited: ["feature_flags"] })
      )
    ).toBeString();
  });

  test("accepts a response quota-limited only for other features", () => {
    expect(
      failedFlagReload({}, stored({ flags: {}, quotaLimited: ["recordings"] }))
    ).toBeUndefined();
  });

  test("rejects a partial response, which keeps cached values for failed flags", () => {
    expect(
      failedFlagReload(
        { seating_map: true },
        stored({ flags: {}, errorsWhileComputingFlags: true })
      )
    ).toBeString();
  });

  test("rejects when nothing was stored", () => {
    expect(failedFlagReload({ seating_map: true }, undefined)).toBeString();
  });
});
