import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  PostHogDistinctId,
  PostHogEventId,
  PostHogProjectId,
  PostHogSessionId,
} from "./identifiers";

describe("PostHog identifiers", () => {
  test.each([
    ["project", PostHogProjectId],
    ["distinct", PostHogDistinctId],
    ["session", PostHogSessionId],
    ["event", PostHogEventId],
  ] as const)("decodes a non-empty %s identifier", (_, identifier) => {
    expect(`${Schema.decodeUnknownSync(identifier)("provider-id")}`).toBe(
      "provider-id"
    );
  });

  test.each([
    ["project", PostHogProjectId],
    ["distinct", PostHogDistinctId],
    ["session", PostHogSessionId],
    ["event", PostHogEventId],
  ] as const)("rejects an empty %s identifier", (_, identifier) => {
    expect(() => Schema.decodeUnknownSync(identifier)("")).toThrow();
  });
});
