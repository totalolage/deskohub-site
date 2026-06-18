import { describe, expect, test } from "bun:test";
import { createPostHogPageUrl } from "./posthog-url";

describe("createPostHogPageUrl", () => {
  test("strips sensitive checkout and auth query params", () => {
    expect(
      createPostHogPageUrl(
        "https://deskohub.test/checkout?paystate=secret&step=pay&token=abc"
      )
    ).toBe("https://deskohub.test/checkout?step=pay");
  });
});
