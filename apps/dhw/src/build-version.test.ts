import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json";
import type { BuildTarget } from "./build-info";
import { makeDhwBuildDefinitions } from "./build-version";
import { dhwRunTimeout, runDhw } from "./testing/dhw-process";

const outputDirectory = mkdtempSync(join(tmpdir(), "dhw-build-test-"));

const prVersionTag = "pr.762.0123456789ab";

/**
 * Compiles for the host but stamps the given target and optional version tag,
 * as `build.ts` does.
 */
const compile = async (buildTarget: BuildTarget, versionTag?: string) => {
  const outfile = join(
    outputDirectory,
    `dhw-${buildTarget}${versionTag === undefined ? "" : `-${versionTag}`}`
  );
  const result = await Bun.build({
    entrypoints: [new URL("./main.ts", import.meta.url).pathname],
    compile: { outfile, autoloadDotenv: false, autoloadBunfig: false },
    define: makeDhwBuildDefinitions(
      packageMetadata.version,
      buildTarget,
      versionTag
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
    compile("linux-x64-baseline"),
    compile("linux-x64-baseline", prVersionTag),
    compile("development"),
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
