import { workspaceSiteOrigin } from "@/shared/utils/site-constants";

/**
 * Where the synthetic test agent publishes its Client ID Metadata Document.
 * A dotted path, so the proxy leaves it alone.
 */
export const customerAgentTestClientPathname = "/oauth/clients/e2e-agent.json";

/**
 * The test agent's client ID: the document's URL on the production host.
 * Preview deployments sit behind deployment protection, so their OAuth
 * server can fetch the document only from the public production host.
 */
const clientId = new URL(customerAgentTestClientPathname, workspaceSiteOrigin)
  .href;

/**
 * The redirect URI's host never resolves. The preview E2E's browser answers
 * it itself and reads the authorization response from the address bar.
 */
const redirectUri = "https://e2e-agent.invalid/callback";

/**
 * The Client ID Metadata Document of the synthetic AI agent the preview E2E
 * connects as: a public client (PKCE, no secret) using the authorization
 * code and refresh grants.
 */
export const customerAgentTestClientMetadata = {
  client_id: clientId,
  client_name: "Workspace E2E Test Agent",
  application_type: "web",
  redirect_uris: [redirectUri],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
} as const;
