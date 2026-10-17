import { describe, expect, test } from "bun:test";
import { unsafeReturnTargets } from "@/shared/testing/unsafe-return-targets.test-utils";
import { parseSameOriginPath } from "./same-origin-path";

const siteOrigin = "https://workspace.deskohub.test";

describe("parseSameOriginPath", () => {
  test("keeps a same-origin path and query and drops the fragment", () => {
    expect(parseSameOriginPath("/cs-CZ/admin/invoices?page=2#top")).toBe(
      "/cs-CZ/admin/invoices?page=2"
    );
    expect(parseSameOriginPath("/admin")).toBe("/admin");
  });

  test("resolves dot segments that stay on the site", () => {
    expect(parseSameOriginPath("/cs-CZ/x/../admin")).toBe("/cs-CZ/admin");
    expect(parseSameOriginPath("/cs-CZ/x/%2e%2e/admin")).toBe("/cs-CZ/admin");
  });

  test.each([
    "/%2F%2Fevil.example",
    "/%2f/evil.example",
    "/x/..%2F/evil.example",
    "/%5Cevil.example",
    "/admin?next=//evil.example",
  ])("keeps encoded separators in %p on the site", (value) => {
    const path = parseSameOriginPath(value);

    expect(path).toBeDefined();
    expect(new URL(path!, siteOrigin).origin).toBe(siteOrigin);
  });

  test.each([
    ...unsafeReturnTargets,
    undefined,
    null,
    "",
    "admin",
    "/admin\\..\\x",
    "/\tadmin",
    "/admin\n",
    `/${"a".repeat(2048)}`,
  ])("rejects %p", (value) => {
    expect(parseSameOriginPath(value)).toBeUndefined();
  });
});
