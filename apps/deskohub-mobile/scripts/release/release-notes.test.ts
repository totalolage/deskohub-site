import { describe, expect, test } from "bun:test";
import { changelogSection, renderReleaseNotes } from "./release-notes";

const changelog = [
  "# Changelog",
  "",
  "## [0.3.0](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.0...mobile-v0.3.0) (2026-12-01)",
  "",
  "",
  "### Features",
  "",
  "* **mobile:** third ([abc1234](https://github.com/totalolage/deskohub-site/commit/abc1234))",
  "",
  "## [0.2.0](https://github.com/totalolage/deskohub-site/compare/mobile-v0.1.0...mobile-v0.2.0) (2026-11-20)",
  "",
  "### Bug Fixes",
  "",
  "* **mobile:** second",
  "",
  "## 0.1.0 (2026-11-10)",
  "",
  "* first",
  "",
].join("\n");

describe("changelogSection", () => {
  test("returns the section for a linked version heading", () => {
    const section = changelogSection(changelog, "0.2.0");
    expect(section?.split("\n")[0]).toStartWith("## [0.2.0](");
    expect(section).toContain("* **mobile:** second");
    expect(section).not.toContain("third");
    expect(section).not.toContain("first");
  });

  test("returns the newest section up to the next version", () => {
    const section = changelogSection(changelog, "0.3.0");
    expect(section).toContain("* **mobile:** third");
    expect(section).not.toContain("second");
  });

  test("returns the last section through the end of the file", () => {
    const section = changelogSection(changelog, "0.1.0");
    expect(section?.split("\n")[0]).toBe("## 0.1.0 (2026-11-10)");
    expect(section).toContain("* first");
  });

  test("does not match a version that only shares a prefix", () => {
    expect(changelogSection(changelog, "0.2")).toBeUndefined();
    expect(changelogSection(changelog, "0.2.00")).toBeUndefined();
    expect(changelogSection(changelog, "10.2.0")).toBeUndefined();
  });

  test("returns undefined for a version without a section", () => {
    expect(changelogSection(changelog, "9.9.9")).toBeUndefined();
  });
});

describe("renderReleaseNotes", () => {
  const release = {
    apkFileName: "deskohub-0.2.0.apk",
    apkSha256: "a".repeat(64),
    certificateSha256: "69428e71".padEnd(64, "0"),
    version: "0.2.0",
    versionCode: 2000,
  };

  test("starts with the changelog section", () => {
    const notes = renderReleaseNotes({
      ...release,
      changelog: changelogSection(changelog, "0.2.0"),
    });
    expect(notes.split("\n")[0]).toStartWith("## [0.2.0](");
    expect(notes).toContain("* **mobile:** second");
  });

  test("publishes the signing certificate as colon-separated hex", () => {
    const notes = renderReleaseNotes({ ...release, changelog: undefined });
    expect(notes).toContain(
      "69:42:8E:71:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00"
    );
    expect(notes).toContain(release.apkSha256);
    expect(notes).toContain(release.apkFileName);
    expect(notes).toContain("2000");
  });

  test("keeps a heading for the version when no changelog section exists", () => {
    const notes = renderReleaseNotes({ ...release, changelog: undefined });
    expect(notes.split("\n")[0]).toBe("## 0.2.0");
  });
});
