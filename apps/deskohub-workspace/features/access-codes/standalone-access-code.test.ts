import { describe, expect, test } from "bun:test";
import { igloohomeApiTimeoutMaximumMilliseconds } from "@deskohub/igloohome";
import { standaloneAccessCodeAttemptStaleAfterMilliseconds } from "./standalone-access-code";

describe("standalone access-code provider budget", () => {
  test("keeps the sequential provider workflow strictly below the stale threshold", () => {
    expect(2 * igloohomeApiTimeoutMaximumMilliseconds).toBeLessThan(
      standaloneAccessCodeAttemptStaleAfterMilliseconds
    );
  });
});
