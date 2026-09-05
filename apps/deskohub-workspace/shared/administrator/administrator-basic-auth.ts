import { createHash, timingSafeEqual } from "node:crypto";
import type { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import type { AdministratorCredentialRegistry } from "./administrator-credentials";

const basicAuthorizationPrefix = "Basic ";

export const getConfiguredAdministratorAuthorizationUsername = (
  authorization: string | null,
  registry: AdministratorCredentialRegistry
): AdministrationActorUsername | null => {
  if (!authorization?.startsWith(basicAuthorizationPrefix)) {
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

    const username = credentials.subarray(0, separatorIndex).toString("utf8");
    const configured = registry.find(
      (credential) => credential.username === username
    );
    if (!configured) {
      return null;
    }

    const actual = createHash("sha256").update(credentials).digest();
    const expected = Buffer.from(configured.credentialDigest, "hex");

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return null;
    }

    return configured.username;
  } catch {
    return null;
  }
};

export const isAdministratorAuthorizationValid = (
  authorization: string | null,
  registry: AdministratorCredentialRegistry
) =>
  getConfiguredAdministratorAuthorizationUsername(authorization, registry) !==
  null;
