import { describe, expect, test } from "bun:test";
import { makeDhwBuildVersion } from "./build-version";

describe("makeDhwBuildVersion", () => {
  test("tags development binaries", () => {
    expect(makeDhwBuildVersion("1.0.0", "development")).toBe(
      "1.0.0+development"
    );
  });

  test("keeps release versions unchanged", () => {
    expect(makeDhwBuildVersion("1.0.0", "darwin-arm64")).toBe("1.0.0");
  });

  test("embeds an explicit PR build tag", () => {
    expect(
      makeDhwBuildVersion("1.0.0", "darwin-arm64", "pr.174.b89835113493")
    ).toBe("1.0.0+pr.174.b89835113493");
  });

  test("rejects invalid build tags", () => {
    expect(() =>
      makeDhwBuildVersion("1.0.0", "darwin-arm64", "pr/174")
    ).toThrow();
  });
});
