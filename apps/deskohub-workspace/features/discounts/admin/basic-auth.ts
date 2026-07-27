import { createHash, timingSafeEqual } from "node:crypto";

const basicAuthorizationPrefix = "Basic ";

export const isDiscountAdminAuthorizationValid = (
  authorization: string | null,
  expectedSha256: string | undefined
) => {
  if (!expectedSha256 || !authorization?.startsWith(basicAuthorizationPrefix)) {
    return false;
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
      Buffer.from(credentials.toString("base64"), "base64").compare(
        credentials
      ) !== 0
    ) {
      return false;
    }

    const actual = createHash("sha256").update(credentials).digest();
    const expected = Buffer.from(expectedSha256, "hex");

    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
};
