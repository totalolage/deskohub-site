import { Schema } from "effect";
import packageMetadata from "../package.json";
import { ReleaseBuildTarget } from "./build-info";
import { type DhwBuildChannel, makeDhwBuildDefinitions } from "./build-version";

const buildTarget = Schema.decodeUnknownSync(
  Schema.Union([ReleaseBuildTarget, Schema.Literal("development")])
)(Bun.argv[2] ?? "development");

// Only the release workflow sets `DHW_BUILD_CHANNEL=release`; any other
// build is tagged and has no default Workspace.
const isRelease =
  Schema.decodeUnknownSync(Schema.UndefinedOr(Schema.Literal("release")))(
    Bun.env.DHW_BUILD_CHANNEL
  ) === "release";
const versionTag = Bun.env.DHW_BUILD_VERSION_TAG;

if (isRelease && versionTag !== undefined) {
  throw new Error("A dhw release can't carry DHW_BUILD_VERSION_TAG.");
}

const buildChannel: DhwBuildChannel = isRelease
  ? { release: true }
  : { release: false, versionTag };

const bunTargets = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-baseline": "bun-linux-x64-baseline",
} satisfies Record<ReleaseBuildTarget, Bun.Build.CompileTarget>;

const bunTarget =
  buildTarget === "development" ? undefined : bunTargets[buildTarget];

const outputName = buildTarget === "development" ? "dhw" : `dhw-${buildTarget}`;

const result = await Bun.build({
  entrypoints: [new URL("./main.ts", import.meta.url).pathname],
  compile: {
    ...(bunTarget === undefined ? {} : { target: bunTarget }),
    outfile: new URL(`../dist/${outputName}`, import.meta.url).pathname,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  define: makeDhwBuildDefinitions(
    packageMetadata.version,
    buildTarget,
    buildChannel
  ),
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exitCode = 1;
}
