import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import type { DhwConfig } from "../config/dhw-config.service";
import {
  type GithubRelease,
  GithubReleaseResult,
} from "./github-release.service";
import { checkForUpdate, selectAvailableUpdate } from "./update.service";
import type {
  AvailableUpdate,
  UpdateState,
} from "./update-state-store.service";

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

describe("selectAvailableUpdate release filtering", () => {
  const target = "linux-x64-baseline";
  const asset = release("1.0.0", target).assets[0];
  if (asset === undefined) throw new Error("The release fixture has no asset.");

  test("maps an eligible release to its update", () => {
    expect(selectAvailableUpdate([release("1.0.0", target)], target)).toEqual({
      version: "1.0.0",
      releaseUrl:
        "https://github.com/totalolage/deskohub-site/releases/tag/dhw-v1.0.0",
      assetUrl:
        "https://github.com/totalolage/deskohub-site/releases/download/dhw-v1.0.0/dhw-linux-x64-baseline",
      assetDigest: `sha256:${"a".repeat(64)}`,
      assetSize: 42,
      target,
    });
  });

  test.each([
    ["draft", { draft: true }],
    ["prerelease", { prerelease: true }],
    ["non-CLI tag", { tag_name: "workspace-v1.0.0" }],
    ["invalid version", { tag_name: "dhw-vnext" }],
    [
      "release page outside the repository",
      { html_url: new URL("https://github.com/another/repo/releases/x") },
    ],
    [
      "release page over plain HTTP",
      {
        html_url: new URL(
          "http://github.com/totalolage/deskohub-site/releases/x"
        ),
      },
    ],
    [
      "release page on another host",
      {
        html_url: new URL(
          "https://example.test/totalolage/deskohub-site/releases/x"
        ),
      },
    ],
    ["zero-byte asset", { assets: [{ ...asset, size: 0 }] }],
    ["fractional asset size", { assets: [{ ...asset, size: 1.5 }] }],
    [
      "non-SHA-256 digest",
      { assets: [{ ...asset, digest: `sha512:${"a".repeat(64)}` }] },
    ],
  ] satisfies ReadonlyArray<readonly [string, Partial<GithubRelease>]>)(
    "rejects a %s",
    (_label, options) => {
      expect(
        selectAvailableUpdate([release("1.0.0", target, options)], target)
      ).toBeUndefined();
    }
  );
});

const releaseBuild = {
  version: "1.0.0",
  target: "linux-x64-baseline",
} as const;

const storedUpdate = (version: string): AvailableUpdate => ({
  version,
  releaseUrl: `https://github.com/totalolage/deskohub-site/releases/tag/dhw-v${version}`,
  assetUrl: `https://github.com/totalolage/deskohub-site/releases/download/dhw-v${version}/dhw-linux-x64-baseline`,
  assetDigest: `sha256:${"b".repeat(64)}`,
  assetSize: 7,
  target: "linux-x64-baseline",
});

const config = (updateChecksDisabled: boolean): DhwConfig["Service"] => ({
  baseUrl: new URL("https://workspace.example.test"),
  requestHeaders: {},
  isCi: true,
  stateDirectory: "/nonexistent/dhw-update-check-test",
  updateChecksDisabled,
});

const now = 1_000_000;

/** Runs one update check against an in-memory state store and release list. */
const runCheck = async ({
  force = false,
  published = true,
  updateChecksDisabled = false,
  state = {},
  result = GithubReleaseResult.Modified({ etag: undefined, releases: [] }),
}: {
  readonly force?: boolean;
  readonly published?: boolean;
  readonly updateChecksDisabled?: boolean;
  readonly state?: UpdateState;
  readonly result?: GithubReleaseResult;
}) => {
  const writes: UpdateState[] = [];
  const listedEtags: Array<string | undefined> = [];
  const check = checkForUpdate({
    force,
    build: published ? releaseBuild : undefined,
    config: config(updateChecksDisabled),
    github: {
      list: (etag) =>
        Effect.sync(() => {
          listedEtags.push(etag);
          return result;
        }),
    },
    stateStore: {
      get: Effect.succeed(state),
      set: (next) =>
        Effect.sync(() => {
          writes.push(next);
        }),
    },
  });
  const available = await TestClock.setTime(now).pipe(
    Effect.andThen(check),
    Effect.provide(TestClock.layer()),
    Effect.runPromise
  );
  return { available, listedEtags, writes };
};

describe("checkForUpdate", () => {
  test("does nothing outside a published release build", async () => {
    const run = await runCheck({ published: false, force: true });

    expect(run.available).toEqual(Option.none());
    expect(run.writes).toEqual([]);
    expect(run.listedEtags).toEqual([]);
  });

  test("skips disabled checks unless forced", async () => {
    const skipped = await runCheck({ updateChecksDisabled: true });
    const forced = await runCheck({ updateChecksDisabled: true, force: true });

    expect(skipped.writes).toEqual([]);
    expect(skipped.listedEtags).toEqual([]);
    expect(forced.listedEtags).toEqual([undefined]);
  });

  test("throttles checks attempted within 30 seconds unless forced", async () => {
    const recent = { lastAttemptedAt: now - 29_999 };
    const throttled = await runCheck({ state: recent });
    const forced = await runCheck({ state: recent, force: true });
    const due = await runCheck({ state: { lastAttemptedAt: now - 30_000 } });

    expect(throttled.available).toEqual(Option.none());
    expect(throttled.writes).toEqual([]);
    expect(throttled.listedEtags).toEqual([]);
    expect(forced.listedEtags).toEqual([undefined]);
    expect(due.listedEtags).toEqual([undefined]);
  });

  test("records the attempt, then stores the newest release and its etag", async () => {
    const state: UpdateState = { lastSuccessfulAt: 5, etag: '"old"' };
    const run = await runCheck({
      state,
      result: GithubReleaseResult.Modified({
        etag: '"new"',
        releases: [release("1.1.0", "linux-x64-baseline")],
      }),
    });
    const newest = selectAvailableUpdate(
      [release("1.1.0", "linux-x64-baseline")],
      "linux-x64-baseline"
    );

    expect(run.listedEtags).toEqual(['"old"']);
    expect(run.writes).toEqual([
      { ...state, lastAttemptedAt: now },
      {
        lastAttemptedAt: now,
        lastSuccessfulAt: now,
        etag: '"new"',
        available: newest,
      },
    ]);
    expect(run.available).toEqual(Option.fromUndefinedOr(newest));
  });

  test("keeps the stored update and etag when releases are unchanged", async () => {
    const run = await runCheck({
      state: { etag: '"stored"', available: storedUpdate("1.2.0") },
      result: GithubReleaseResult.NotModified({ etag: undefined }),
    });

    expect(run.writes.at(-1)).toEqual({
      lastAttemptedAt: now,
      lastSuccessfulAt: now,
      etag: '"stored"',
      available: storedUpdate("1.2.0"),
    });
    expect(run.available).toEqual(Option.some(storedUpdate("1.2.0")));
  });

  test("stores no etag or update when neither exists", async () => {
    const run = await runCheck({});

    expect(run.writes.at(-1)).toEqual({
      lastAttemptedAt: now,
      lastSuccessfulAt: now,
    });
    expect(run.available).toEqual(Option.none());
  });

  test("reports no update when the stored release is not newer", async () => {
    const run = await runCheck({
      state: { available: storedUpdate("1.0.0") },
      result: GithubReleaseResult.NotModified({ etag: '"same"' }),
    });

    expect(run.writes.at(-1)).toEqual({
      lastAttemptedAt: now,
      lastSuccessfulAt: now,
      etag: '"same"',
      available: storedUpdate("1.0.0"),
    });
    expect(run.available).toEqual(Option.none());
  });
});
