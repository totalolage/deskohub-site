import { describe, expect, it } from "bun:test";
import { Effect, Exit } from "effect";
import {
  ReadLimitExceededError,
  readLimitSentinel,
  requireWithinReadLimit,
} from "./read-limit";

describe("requireWithinReadLimit", () => {
  it("returns rows when the count equals the limit", () => {
    const rows = [1, 2, 3];
    expect(Effect.runSync(requireWithinReadLimit(rows, 3))).toEqual(rows);
  });

  it("fails when the sentinel row is present", () => {
    const exit = Effect.runSyncExit(requireWithinReadLimit([1, 2, 3, 4], 3));
    expect(exit).toEqual(Exit.fail(new ReadLimitExceededError({ limit: 3 })));
  });

  it("fetches one row past the limit", () => {
    expect(readLimitSentinel(500)).toBe(501);
  });
});
