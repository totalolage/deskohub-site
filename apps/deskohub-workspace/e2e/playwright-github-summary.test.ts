import { expect, test } from "bun:test";
import type { FullResult, Suite } from "@playwright/test/reporter";
import { formatPlaywrightGitHubSummary } from "./playwright-github-summary";

test("formats one complete Playwright job summary", () => {
  const outcomes = ["expected", "expected", "unexpected", "skipped"] as const;
  const suite = {
    allTests: () => outcomes.map((outcome) => ({ outcome: () => outcome })),
  } as unknown as Suite;
  const result = { duration: 12_345, status: "failed" } as FullResult;

  expect(formatPlaywrightGitHubSummary("Workspace E2E", suite, result)).toBe(
    [
      "## Workspace E2E",
      "",
      "**Status:** failed",
      "",
      "2 passed · 1 failed · 0 flaky · 1 skipped",
      "",
      "**Duration:** 12.3s",
      "",
    ].join("\n")
  );
});
