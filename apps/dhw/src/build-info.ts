import { Schema } from "effect";
import packageMetadata from "../package.json";

declare const __DHW_VERSION__: string | undefined;
declare const __DHW_BUILD_TARGET__: string | undefined;

export const ReleaseBuildTarget = Schema.Literals([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64-baseline",
]);

export type ReleaseBuildTarget = typeof ReleaseBuildTarget.Type;
export type BuildTarget = ReleaseBuildTarget | "development";

export const DHW_VERSION =
  typeof __DHW_VERSION__ === "undefined"
    ? packageMetadata.version
    : __DHW_VERSION__;

export const DHW_BUILD_TARGET: BuildTarget =
  typeof __DHW_BUILD_TARGET__ === "undefined"
    ? "development"
    : Schema.decodeUnknownSync(
        Schema.Union([ReleaseBuildTarget, Schema.Literal("development")])
      )(__DHW_BUILD_TARGET__);

/**
 * Only a published release defaults to the production Workspace and updates
 * itself. `build-version.ts` keeps the plain package version for release
 * builds only; PR artifacts and every other build carry a version tag
 * (`+pr.<number>.<head-sha>`, `+development`), even on a release target.
 */
export const isReleaseBuild =
  DHW_BUILD_TARGET !== "development" && DHW_VERSION === packageMetadata.version;
