import { isLoopbackHostname } from "@/shared/utils/hostname";
import {
  administrationAgentScope,
  customerAgentScopes,
  offlineAccessAgentScope,
} from "./agent-scopes";

/**
 * Where the OAuth server sends a customer who connects an AI agent: the
 * sign-in step, then the consent step. The proxy places both on the
 * customer's locale.
 */
export const customerAgentSignInPath = "/auth/connect";
export const customerAgentConsentPath = "/auth/consent";

/** The customer MCP server's path on every Workspace host. */
export const customerMcpServerPath = "/api/mcp";

/**
 * The OAuth discovery documents agents read before they connect: the MCP
 * server's protected-resource metadata (RFC 9728), which names the
 * authorization server, and that server's metadata (RFC 8414).
 */
export const customerAgentDiscoveryPaths = {
  protectedResource: "/.well-known/oauth-protected-resource",
  authorizationServer: "/.well-known/oauth-authorization-server/api/auth",
} as const;

/** The OAuth authorization endpoint the sign-in step resumes through. */
export const customerAgentAuthorizePath = "/api/auth/oauth2/authorize";

/**
 * Marks a visit to the sign-in step that comes straight back from signing
 * in, so a request to sign in again counts as satisfied.
 */
const customerAgentSignedInParam = "signed_in";

/**
 * Parameters the OAuth server adds when it signs the authorization request
 * it hands to the sign-in and consent pages.
 */
const signedRequestParams = ["sig", "exp", "ba_iat", "ba_param", "ba_pl"];

/** `prompt` values that ask the customer to sign in again. */
const signInPrompts = ["login", "create"];

const promptsOf = (request: URLSearchParams) =>
  (request.get("prompt") ?? "").split(" ").filter(Boolean);

const asksToSignIn = (request: URLSearchParams) =>
  request.has("max_age") ||
  promptsOf(request).some((prompt) => signInPrompts.includes(prompt));

/** The request with its sign-in demands dropped, once the customer has signed in. */
const withSignInSatisfied = (request: URLSearchParams) => {
  const satisfied = new URLSearchParams(request);
  const prompts = promptsOf(request).filter(
    (prompt) => !signInPrompts.includes(prompt)
  );
  if (prompts.length) satisfied.set("prompt", prompts.join(" "));
  else satisfied.delete("prompt");
  satisfied.delete("max_age");
  return satisfied;
};

export type CustomerAgentConnectStep =
  /** The query names no OAuth client, so there is nothing to continue. */
  | { readonly step: "unknown-request" }
  /** Sign in, then come back to `returnTo`. */
  | { readonly step: "sign-in"; readonly returnTo: string }
  /** Run the authorization request again at `location`. */
  | { readonly step: "authorize"; readonly location: string };

/**
 * What the sign-in step does with the authorization request in `query`.
 *
 * Signed out, or asked to sign in again (`prompt=login`, `prompt=create`,
 * `max_age`), the customer signs in first and comes back to `connectPath`
 * marked as freshly signed in. Signed in, the original request runs again
 * at the authorization endpoint without the server's signature, so the
 * server validates it from scratch and continues to consent. A fresh sign-in
 * satisfies a request to sign in again, as the server's own post-sign-in
 * resume does.
 */
export const resolveCustomerAgentConnectStep = ({
  connectPath,
  query,
  signedIn,
}: {
  /** The locale's sign-in step path, without a query. */
  readonly connectPath: string;
  readonly query: URLSearchParams;
  readonly signedIn: boolean;
}): CustomerAgentConnectStep => {
  const request = new URLSearchParams(query);
  for (const param of [...signedRequestParams, customerAgentSignedInParam]) {
    request.delete(param);
  }
  if (!request.get("client_id")) return { step: "unknown-request" };

  const freshlySignedIn = signedIn && query.has(customerAgentSignedInParam);
  if (!signedIn || (!freshlySignedIn && asksToSignIn(request))) {
    const returnQuery = new URLSearchParams(request);
    returnQuery.set(customerAgentSignedInParam, "1");
    return { step: "sign-in", returnTo: `${connectPath}?${returnQuery}` };
  }

  const resumed = freshlySignedIn ? withSignInSatisfied(request) : request;
  return {
    step: "authorize",
    location: `${customerAgentAuthorizePath}?${resumed}`,
  };
};

/**
 * The scopes the consent page explains, in the order it lists them: the
 * customer agent scopes, then staying connected without the customer. The
 * administration scope is asked about on its own, and only of
 * administrators.
 */
export const customerAgentConsentScopes = [
  ...customerAgentScopes,
  offlineAccessAgentScope,
] as const;

export type CustomerAgentConsentScope =
  (typeof customerAgentConsentScopes)[number];

/**
 * Where the OAuth server sends the customer's answer, and with it the
 * authorization code. `host` is the redirect URI's hostname, or the scheme of
 * an app's own URL scheme, which has none. `local` marks a redirect that stays
 * on the customer's device (a loopback host or an app scheme), where any app
 * can claim to be the assistant.
 */
export type CustomerAgentConsentRedirect = {
  readonly host: string;
  readonly local: boolean;
};

export type CustomerAgentConsentRequest =
  /** The query is not a signed request naming an OAuth client. */
  | { readonly status: "unknown-request" }
  /** The signed request is past its expiry. */
  | { readonly status: "expired" }
  /** The customer decides whether `clientId` gets `scopes` at `redirect`. */
  | {
      readonly status: "pending";
      readonly clientId: string;
      readonly scopes: ReadonlyArray<CustomerAgentConsentScope>;
      readonly redirect: CustomerAgentConsentRedirect;
      /** Whether the request also asks for the administration scope. */
      readonly administration: boolean;
    };

const readConsentRedirect = (
  redirectUri: string | null
): CustomerAgentConsentRedirect | undefined => {
  const url = redirectUri ? URL.parse(redirectUri) : null;
  if (!url) return undefined;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { host: url.protocol.slice(0, -1), local: true };
  }
  return { host: url.hostname, local: isLoopbackHostname(url.hostname) };
};

/**
 * What the consent step asks the customer, from the signed authorization
 * request in `query` at `now` (epoch milliseconds). The OAuth server verifies
 * the signature when the customer answers; this only spots requests that
 * can't succeed, including one without a readable `redirect_uri`, which the
 * server always signs. Without `scope` the request asks for every scope;
 * scopes the page can't explain are left out.
 */
export const readCustomerAgentConsentRequest = (
  query: URLSearchParams,
  now: number
): CustomerAgentConsentRequest => {
  const clientId = query.get("client_id");
  const expiresAt = Number(query.get("exp") || Number.NaN);
  const redirect = readConsentRedirect(query.get("redirect_uri"));
  if (
    !clientId ||
    !query.get("sig") ||
    !Number.isFinite(expiresAt) ||
    !redirect
  ) {
    return { status: "unknown-request" };
  }
  if (expiresAt * 1000 <= now) return { status: "expired" };

  const requested = query.get("scope")?.split(" ");
  return {
    status: "pending",
    clientId,
    scopes: requested
      ? customerAgentConsentScopes.filter((scope) => requested.includes(scope))
      : customerAgentConsentScopes,
    redirect,
    administration: requested?.includes(administrationAgentScope) ?? true,
  };
};
