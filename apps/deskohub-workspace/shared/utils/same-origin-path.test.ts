import { describe, expect, test } from "bun:test";
import { parseSameOriginPath } from "./same-origin-path";

describe("parseSameOriginPath", () => {
  test("keeps a same-origin path and query and drops the fragment", () => {
    expect(parseSameOriginPath("/cs-CZ/admin/invoices?page=2#top")).toBe(
      "/cs-CZ/admin/invoices?page=2"
    );
    expect(parseSameOriginPath("/admin")).toBe("/admin");
  });

  test.each([
    undefined,
    null,
    "",
    "admin",
    "https://evil.example/admin",
    "//evil.example/admin",
    "/\\evil.example/admin",
    "/\\/evil.example",
    "/admin\\..\\x",
    "/\tadmin",
    "/admin\n",
    "javascript:alert(1)",
    `/${"a".repeat(2048)}`,
  ])("rejects %p", (value) => {
    expect(parseSameOriginPath(value)).toBeUndefined();
  });
});
