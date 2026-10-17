import { describe, expect, test } from "bun:test";
import { parseSameOriginPath } from "./same-origin-path";

describe("same-origin path", () => {
  test.each([
    ["/en-US/account", "/en-US/account"],
    [
      "/en-US/reservation?date=2026-10-20&seat=a",
      "/en-US/reservation?date=2026-10-20&seat=a",
    ],
    [
      "/en-US/reservation?state=a.b-c_d#details",
      "/en-US/reservation?state=a.b-c_d",
    ],
    ["/en-US/a/../account", "/en-US/account"],
    [
      "/en-US/reservation?next=%2F%2Fevil.example",
      "/en-US/reservation?next=%2F%2Fevil.example",
    ],
  ])("keeps %s as %s", (candidate, path) => {
    expect(parseSameOriginPath(candidate)).toBe(path);
  });

  test.each([
    null,
    undefined,
    "",
    "en-US/account",
    "https://evil.example/en-US/account",
    "javascript:alert(1)",
    "//evil.example/en-US",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2F%2Fevil.example",
    "/en-US%2f..%2f..%2fadmin",
    "/en-US%5caccount",
    "/en-US/\taccount",
    "/en-US/\naccount",
  ])("rejects %p", (candidate) => {
    expect(parseSameOriginPath(candidate)).toBeUndefined();
  });
});
