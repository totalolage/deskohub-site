import { createHash, timingSafeEqual } from "node:crypto";

const basicAuthorizationPrefix = "Basic ";

export const getAdministrationAuthorizationUsername = (
  authorization: string | null,
  expectedSha256: string | undefined
) => {
  if (!expectedSha256 || !authorization?.startsWith(basicAuthorizationPrefix)) {
    return null;
  }

  const encodedCredentials = authorization.slice(
    basicAuthorizationPrefix.length
  );

  try {
    const credentials = Buffer.from(encodedCredentials, "base64");
    const separatorIndex = credentials.indexOf(":");
    if (
      separatorIndex <= 0 ||
      separatorIndex === credentials.length - 1 ||
      credentials.toString("base64") !== encodedCredentials
    ) {
      return null;
    }

    const actual = createHash("sha256").update(credentials).digest();
    const expected = Buffer.from(expectedSha256, "hex");

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return null;
    }

    const usernameBytes = credentials.subarray(0, separatorIndex);
    const username = usernameBytes.toString("utf8");
    return Buffer.from(username).equals(usernameBytes) ? username : null;
  } catch {
    return null;
  }
};

export const isAdministrationAuthorizationValid = (
  authorization: string | null,
  expectedSha256: string | undefined
) =>
  getAdministrationAuthorizationUsername(authorization, expectedSha256) !==
  null;
