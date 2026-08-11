import { describe, expect, test } from "bun:test";

import { buildMobileApiUrl } from "./mobile-api-url";

describe("mobile API URL building", () => {
  test("preserves deployment-scoped preview query parameters", () => {
    const url = buildMobileApiUrl(
      "https://preview.example.test/some/page?share=value&mode=preview",
      "/api/v1/mobile/catalog"
    );

    expect(url.pathname).toBe("/api/v1/mobile/catalog");
    expect(url.searchParams.get("share")).toBe("value");
    expect(url.searchParams.get("mode")).toBe("preview");
  });

  test("preserves duplicate parameters", () => {
    const url = buildMobileApiUrl(
      "https://preview.example.test?flag=one&flag=two",
      "/api/v1/mobile/session"
    );

    expect(url.searchParams.getAll("flag")).toEqual(["one", "two"]);
  });
});
