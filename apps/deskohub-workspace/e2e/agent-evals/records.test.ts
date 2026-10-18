import { describe, expect, test } from "bun:test";
import { isCreatedDuringAgentEvalRun } from "./records";

const runStartedAt = "2026-10-18T12:00:00.000Z";

describe("isCreatedDuringAgentEvalRun", () => {
  test("claims a contact profile checkout created during the run", () => {
    expect(
      isCreatedDuringAgentEvalRun(
        { created: "2026-10-18T12:03:00.000Z" },
        runStartedAt
      )
    ).toBe(true);
  });

  test.each([
    ["an existing customer's profile", "2026-09-01T08:00:00.000Z"],
    ["a profile without a creation time", null],
    ["a profile with an unreadable creation time", "yesterday"],
  ])("leaves %s alone", (_label, created) => {
    expect(isCreatedDuringAgentEvalRun({ created }, runStartedAt)).toBe(false);
  });
});
