import { Schema } from "effect";
import packageMetadata from "../package.json";
import { ReleaseBuildTarget } from "./build-info";
import { makeDhwBuildVersion } from "./build-version";

const buildTarget = Schema.decodeUnknownSync(
  Schema.Union([ReleaseBuildTarget, Schema.Literal("development")])
)(Bun.argv[2] ?? "development");

const bunTargets = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-baseline": "bun-linux-x64-baseline",
} satisfies Record<ReleaseBuildTarget, Bun.Build.CompileTarget>;

const bunTarget =
  buildTarget === "development" ? undefined : bunTargets[buildTarget];

const outputName = buildTarget === "development" ? "dhw" : `dhw-${buildTarget}`;
const buildVersion = makeDhwBuildVersion(
  packageMetadata.version,
  buildTarget,
  Bun.env.DHW_BUILD_VERSION_TAG
);

const result = await Bun.build({
  entrypoints: [new URL("./main.ts", import.meta.url).pathname],
  compile: {
    ...(bunTarget === undefined ? {} : { target: bunTarget }),
    outfile: new URL(`../dist/${outputName}`, import.meta.url).pathname,
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  define: {
    __DHW_VERSION__: JSON.stringify(buildVersion),
    __DHW_BUILD_TARGET__: JSON.stringify(buildTarget),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exitCode = 1;
}
