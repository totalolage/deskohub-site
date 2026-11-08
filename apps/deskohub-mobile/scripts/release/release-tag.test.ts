import { expect, test } from "bun:test";
import { releaseTag, releaseTagVersion } from "./release-tag";

test("reads the version from a mobile release tag", () => {
  expect(releaseTagVersion("mobile-v1.2.3")).toBe("1.2.3");
});

test.each([
  "dhw-v1.2.3",
  "mobile-1.2.3",
  "v1.2.3",
  "mobile-v1.2",
  "mobile-v1.2.3-rc.1",
  "refs/tags/mobile-v1.2.3",
])("rejects %p", (tag) => {
  expect(() => releaseTagVersion(tag)).toThrow();
});

test("names the tag for a version", () => {
  expect(releaseTag("1.2.3")).toBe("mobile-v1.2.3");
  expect(releaseTagVersion(releaseTag("0.4.12"))).toBe("0.4.12");
});
