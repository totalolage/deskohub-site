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
