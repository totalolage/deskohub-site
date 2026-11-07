import { parseAppVersion } from "../../app.config";

// Mobile releases are tagged `mobile-vX.Y.Z`, where X.Y.Z is `expo.version` in
// app.json, the way dhw releases are tagged `dhw-vX.Y.Z`.
const releaseTagPrefix = "mobile-v";

export const releaseTag = (version: string): string =>
  `${releaseTagPrefix}${version}`;

export const releaseTagVersion = (tag: string): string => {
  if (!tag.startsWith(releaseTagPrefix)) {
    throw new Error(
      `Release tag ${JSON.stringify(tag)} must start with ${releaseTagPrefix}.`
    );
  }
  const version = tag.slice(releaseTagPrefix.length);
  parseAppVersion(version);
  return version;
};
