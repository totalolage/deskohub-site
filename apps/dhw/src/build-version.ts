import { Schema } from "effect";
import type { BuildTarget } from "./build-info";

const BuildVersionTag = Schema.String.check(
  Schema.isPattern(/^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/)
);

export const makeDhwBuildVersion = (
  packageVersion: string,
  buildTarget: BuildTarget,
  configuredTag?: string
) => {
  const tag =
    configuredTag ??
    (buildTarget === "development" ? "development" : undefined);

  return tag === undefined
    ? packageVersion
    : `${packageVersion}+${Schema.decodeUnknownSync(BuildVersionTag)(tag)}`;
};

/**
 * The compile-time constants `build-info.ts` reads. A release build target
 * makes the binary default to the production Workspace.
 */
export const makeDhwBuildDefinitions = (
  packageVersion: string,
  buildTarget: BuildTarget,
  configuredTag?: string
) => ({
  __DHW_VERSION__: JSON.stringify(
    makeDhwBuildVersion(packageVersion, buildTarget, configuredTag)
  ),
  __DHW_BUILD_TARGET__: JSON.stringify(buildTarget),
});
