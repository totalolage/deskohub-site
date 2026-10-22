import { Schema } from "effect";
import type { BuildTarget } from "./build-info";

const BuildVersionTag = Schema.String.check(
  Schema.isPattern(/^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/)
);

/**
 * How a build is published. Only a release keeps the plain package version;
 * every other build is tagged, `development` unless it names its own tag,
 * such as a PR artifact's `pr.<number>.<head-sha>`.
 */
export type DhwBuildChannel =
  | { readonly release: true }
  | { readonly release: false; readonly versionTag?: string };

export const makeDhwBuildVersion = (
  packageVersion: string,
  buildTarget: BuildTarget,
  channel: DhwBuildChannel
) => {
  if (channel.release) {
    if (buildTarget === "development") {
      throw new Error("A dhw release needs a release build target.");
    }
    return packageVersion;
  }

  const tag = channel.versionTag ?? "development";
  return `${packageVersion}+${Schema.decodeUnknownSync(BuildVersionTag)(tag)}`;
};

/**
 * The compile-time constants `build-info.ts` reads. Only a release build
 * defaults to the production Workspace.
 */
export const makeDhwBuildDefinitions = (
  packageVersion: string,
  buildTarget: BuildTarget,
  channel: DhwBuildChannel
) => ({
  __DHW_VERSION__: JSON.stringify(
    makeDhwBuildVersion(packageVersion, buildTarget, channel)
  ),
  __DHW_BUILD_TARGET__: JSON.stringify(buildTarget),
});
