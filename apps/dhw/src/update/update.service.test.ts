import { describe, expect, test } from "bun:test";
import type { GithubRelease } from "./github-release.service";
import { selectAvailableUpdate } from "./update.service";

const release = (
  version: string,
  target: string,
  options: Partial<GithubRelease> = {}
): GithubRelease => ({
  tag_name: `dhw-v${version}`,
  html_url: new URL(
    `https://github.com/totalolage/deskohub-site/releases/tag/dhw-v${version}`
  ),
  draft: false,
  prerelease: false,
  immutable: true,
  assets: [
    {
      name: `dhw-${target}`,
      browser_download_url: new URL(
        `https://github.com/totalolage/deskohub-site/releases/download/dhw-v${version}/dhw-${target}`
      ),
      size: 42,
      digest: `sha256:${"a".repeat(64)}`,
    },
  ],
  ...options,
});

describe("selectAvailableUpdate", () => {
  test("selects the newest immutable release for the embedded target", () => {
    const update = selectAvailableUpdate(
      [
        release("0.2.0", "darwin-arm64"),
        release("0.3.0", "linux-x64-baseline"),
        release("0.1.0", "linux-x64-baseline"),
      ],
      "linux-x64-baseline"
    );

    expect(update?.version).toBe("0.3.0");
    expect(update?.target).toBe("linux-x64-baseline");
  });

  test("rejects mutable, partial, and wrong-target releases", () => {
    const mutable = release("0.4.0", "linux-x64-baseline", {
      immutable: false,
    });
    const missingDigest = release("0.3.0", "linux-x64-baseline", {
      assets: [
        {
          name: "dhw-linux-x64-baseline",
          browser_download_url: new URL("https://example.test/dhw"),
          size: 42,
          digest: null,
        },
      ],
    });

    expect(
      selectAvailableUpdate(
        [
          mutable,
          missingDigest,
          release("0.5.0-beta.1", "linux-x64-baseline"),
          release("0.2.0", "darwin-x64"),
        ],
        "linux-x64-baseline"
      )
    ).toBeUndefined();
  });

  test("rejects assets outside the repository release path", () => {
    const forgedAsset = release("0.4.0", "linux-x64-baseline", {
      assets: [
        {
          name: "dhw-linux-x64-baseline",
          browser_download_url: new URL(
            "https://github.com/another/repository/releases/download/v0.4.0/dhw-linux-x64-baseline"
          ),
          size: 42,
          digest: `sha256:${"a".repeat(64)}`,
        },
      ],
    });

    expect(
      selectAvailableUpdate([forgedAsset], "linux-x64-baseline")
    ).toBeUndefined();
  });
});
