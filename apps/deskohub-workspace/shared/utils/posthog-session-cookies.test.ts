import { describe, expect, test } from "bun:test";
import { createPostHogSessionCookieStrings } from "./posthog-session-cookies";

describe("PostHog session cookies", () => {
  test("rejects empty identifiers from the PostHog browser SDK", () => {
    expect(() =>
      createPostHogSessionCookieStrings({
        distinctId: "",
        sessionId: "session-id",
      })
    ).toThrow();
  });
});
