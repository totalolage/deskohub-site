import { Schema } from "effect";
import { AdministratorUsername } from "../shared/administrator/administrator-credentials";
import { workspaceE2EError } from "./errors";
import { addRedaction } from "./runtime";

const basicAuthorizationCredentialSeparator = ":";
const basicAuthorizationPrefix = "Basic ";

export interface WorkspaceE2EAdminCredential {
  readonly authorization: string;
  readonly password: string;
  readonly username: string;
}

export const isAdminBasicAuthCredentialPair = (value: string): boolean => {
  const separatorIndex = value.indexOf(basicAuthorizationCredentialSeparator);
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return false;
  const username = value.slice(0, separatorIndex);
  return (
    username.trim() === username && Schema.is(AdministratorUsername)(username)
  );
};

export const makeWorkspaceE2EAdminCredential = (
  credentialPair: string | undefined
): WorkspaceE2EAdminCredential => {
  if (!credentialPair || !isAdminBasicAuthCredentialPair(credentialPair)) {
    throw workspaceE2EError(
      "WORKSPACE_E2E_ADMIN_BASIC_AUTH must be a username:password pair. Provision the workspace-checkout-e2e GitHub Actions environment secret WORKSPACE_E2E_ADMIN_BASIC_AUTH and the matching Preview-only Vercel environment variable ADMIN_BASIC_AUTH_CREDENTIALS for the deskohub-workspace project (a username:<sha-256 hex digest of the pair> line) before running the access-code creation case.",
      { operation: "decode the workspace E2E admin Basic auth credential" }
    );
  }
  const separatorIndex = credentialPair.indexOf(
    basicAuthorizationCredentialSeparator
  );
  const username = credentialPair.slice(0, separatorIndex);
  const password = credentialPair.slice(separatorIndex + 1);
  const authorization = `${basicAuthorizationPrefix}${Buffer.from(credentialPair).toString("base64")}`;
  addRedaction(credentialPair);
  addRedaction(password, true);
  addRedaction(authorization, true);
  return { authorization, password, username };
};
