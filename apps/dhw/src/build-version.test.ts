import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json";
import type { BuildTarget } from "./build-info";
import {
  type DhwBuildChannel,
  makeDhwBuildDefinitions,
  makeDhwBuildVersion,
} from "./build-version";
import { dhwRunTimeout, runDhw } from "./testing/dhw-process";

const outputDirectory = mkdtempSync(join(tmpdir(), "dhw-build-test-"));

const prVersionTag = "pr.762.0123456789ab";

/**
 * Compiles for the host but stamps the given target and channel, as
 * `build.ts` does.
 */
const compile = async (
  name: string,
  buildTarget: BuildTarget,
  channel: DhwBuildChannel
) => {
  const outfile = join(outputDirectory, `dhw-${name}`);
  const result = await Bun.build({
    entrypoints: [new URL("./main.ts", import.meta.url).pathname],
    compile: { outfile, autoloadDotenv: false, autoloadBunfig: false },
    define: makeDhwBuildDefinitions(
      packageMetadata.version,
      buildTarget,
      channel
    ),
  });
  if (!result.success) throw new AggregateError(result.logs);
  return [outfile];
};

let releaseBinary: ReadonlyArray<string>;
let pullRequestBinary: ReadonlyArray<string>;
let developmentBinary: ReadonlyArray<string>;

beforeAll(async () => {
  [releaseBinary, pullRequestBinary, developmentBinary] = await Promise.all([
    compile("release", "linux-x64-baseline", { release: true }),
    compile("pull-request", "linux-x64-baseline", {
      release: false,
      versionTag: prVersionTag,
    }),
    compile("development", "development", { release: false }),
  ]);
}, 60_000);

afterAll(() => {
  rmSync(outputDirectory, { recursive: true, force: true });
});

describe("compiled dhw", () => {
  test(
    "a release build starts without a selected Workspace",
    async () => {
      const run = await runDhw(["version", "--json"], {
        executable: releaseBinary,
      });

      expect(run.exitCode).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({
        version: packageMetadata.version,
        target: "linux-x64-baseline",
      });
      expect(run.egress).toEqual([]);
    },
    dhwRunTimeout
  );

  test(
    "a PR build fails closed without a selected Workspace",
    async () => {
      const run = await runDhw(["version", "--json"], {
        executable: pullRequestBinary,
      });

      expect(run.exitCode).not.toBe(0);
      expect(run.stdout + run.stderr).toContain(
        "This dhw build has no default Workspace"
      );
      expect(run.egress).toEqual([]);
    },
    dhwRunTimeout
  );

  test(
    "a PR build runs against the selected Workspace",
    async () => {
      const run = await runDhw(["version", "--json"], {
        executable: pullRequestBinary,
        workspace: "http://localhost:3000",
      });

      expect(run.exitCode).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({
        version: `${packageMetadata.version}+${prVersionTag}`,
        target: "linux-x64-baseline",
      });
    },
    dhwRunTimeout
  );

  test(
    "a PR build can't update itself",
    async () => {
      const run = await runDhw(["update", "--json"], {
        executable: pullRequestBinary,
        workspace: "http://localhost:3000",
      });

      expect(run.exitCode).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({ status: "development-build" });
      expect(run.egress).toEqual([]);
    },
    dhwRunTimeout
  );

  test(
    "a development build fails closed without a selected Workspace",
    async () => {
      const run = await runDhw(["version", "--json"], {
        executable: developmentBinary,
      });

      expect(run.exitCode).not.toBe(0);
      expect(run.stdout + run.stderr).toContain(
        "This dhw build has no default Workspace"
      );
    },
    dhwRunTimeout
  );

  test(
    "a development build runs against the selected Workspace",
    async () => {
      const run = await runDhw(["version", "--json"], {
        executable: developmentBinary,
        workspace: "http://localhost:3000",
      });

      expect(run.exitCode).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ target: "development" });
    },
    dhwRunTimeout
  );
});

describe("makeDhwBuildVersion", () => {
  test("keeps the plain package version only for a release", () => {
    expect(
      makeDhwBuildVersion("1.2.3", "linux-x64-baseline", { release: true })
    ).toBe("1.2.3");
  });

  test("tags a release-target build outside the release channel", () => {
    expect(
      makeDhwBuildVersion("1.2.3", "linux-x64-baseline", { release: false })
    ).toBe("1.2.3+development");
    expect(
      makeDhwBuildVersion("1.2.3", "darwin-arm64", {
        release: false,
        versionTag: prVersionTag,
      })
    ).toBe(`1.2.3+${prVersionTag}`);
  });

  test("refuses a release without a release build target", () => {
    expect(() =>
      makeDhwBuildVersion("1.2.3", "development", { release: true })
    ).toThrow("A dhw release needs a release build target.");
  });
});
