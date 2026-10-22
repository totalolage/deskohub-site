/**
 * The Client ID Metadata Documents that the app-directory clients publish,
 * copied from their hosts on 2026-10-22, so tests register exactly what the
 * OAuth server fetches in production.
 */

/** ChatGPT's stable client, used with servers that send RFC 9207 `iss`. */
export const chatGptClientMetadata = {
  client_id: "https://chatgpt.com/oauth/client.json",
  client_uri: "https://chatgpt.com/",
  redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  client_name: "ChatGPT",
  logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
  token_endpoint_auth_signing_alg: "RS256",
  jwks_uri: "https://chatgpt.com/oauth/jwks.json",
} as const;

/**
 * ChatGPT's per-connector client, which it uses with servers that don't
 * meet its issuer-identification requirements: the client ID and redirect
 * URI carry a callback ID. OpenAI documents the URL shapes but publishes no
 * example document, so the rest follows the stable client.
 */
export const chatGptCallbackClientMetadata = (callbackId: string) => ({
  ...chatGptClientMetadata,
  client_id: `https://chatgpt.com/oauth/${callbackId}/client.json`,
  redirect_uris: [`https://chatgpt.com/connector/oauth/${callbackId}`],
});

/** The client of Claude's web, desktop, and mobile apps. */
export const claudeClientMetadata = {
  client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  client_name: "Claude",
  client_uri: "https://claude.ai",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  grant_types: [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  ],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
} as const;

/**
 * Claude Code's client. It listens on a loopback port it picks per sign-in,
 * so its redirect URIs name no port.
 */
export const claudeCodeClientMetadata = {
  client_id: "https://claude.ai/oauth/claude-code-client-metadata",
  client_name: "Claude Code",
  client_uri: "https://claude.ai",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
} as const;
