import { administrationAgentScope } from "@/features/account/agent-scopes";
import {
  type CustomerAgentConsentScope,
  customerAgentConsentPath,
  customerMcpServerPath,
} from "@/features/account/customer-agent-routes";
import { customerAgentTestClientMetadata } from "@/features/account/customer-agent-test-client";
import type { Locale } from "@/features/i18n";
import { withLocalePrefixAndSearch } from "@/features/i18n/routing";
import { parseUrl } from "../runtime";

/**
 * The test agent's redirect URI. The host never resolves; the case's browser
 * context answers it itself, so the authorization code never leaves the
 * runner.
 */
export const [customerAgentRedirectUri] =
  customerAgentTestClientMetadata.redirect_uris;

/** What the synthetic agent asks for: booking and reading reservations. */
export const customerAgentRequestedScopes = [
  "reservations:read",
  "reservations:create",
  "offline_access",
] as const satisfies readonly CustomerAgentConsentScope[];

/** A scope the synthetic agent can ask for. */
export type CustomerAgentRequestedScope =
  | CustomerAgentConsentScope
  | typeof administrationAgentScope;

/**
 * What the synthetic agent asks an account for when it wants the
 * administration: one customer scope beside it, so the customer tools stay in
 * the grant, and offline access as every agent asks for it.
 */
export const administrationAgentRequestedScopes = [
  "reservations:read",
  "offline_access",
  administrationAgentScope,
] as const satisfies readonly CustomerAgentRequestedScope[];

/** The deployment's MCP resource, which every token must be bound to. */
export const customerMcpResourceFor = (baseUrl: string) =>
  new URL(customerMcpServerPath, baseUrl).toString();

/** Whether a browser URL is the consent page, in any locale. */
export const isCustomerAgentConsentUrl = (url: string, baseUrl: string) => {
  const current = parseUrl(url);
  return (
    current !== undefined &&
    current.origin === new URL(baseUrl).origin &&
    current.pathname.endsWith(customerAgentConsentPath)
  );
};

/**
 * The same consent request in another locale: the signed OAuth query stays
 * as issued and only the locale prefix changes, as the language switcher
 * would change it.
 */
export const localizeCustomerAgentConsentUrl = (
  url: string,
  locale: Locale
) => {
  const current = new URL(url);
  return new URL(
    withLocalePrefixAndSearch(customerAgentConsentPath, locale, current.search),
    current.origin
  ).toString();
};

/** Whether a browser URL is the agent's redirect URI. */
export const isCustomerAgentCallbackUrl = (url: string) => {
  const current = parseUrl(url);
  const expected = new URL(customerAgentRedirectUri);
  return (
    current !== undefined &&
    current.origin === expected.origin &&
    current.pathname === expected.pathname
  );
};

export type CustomerAgentCallback =
  | { readonly kind: "code"; readonly code: string; readonly iss?: string }
  | { readonly kind: "error"; readonly error: string };

/**
 * Reads the authorization response the server sent to the agent's redirect
 * URI. A response for another request (wrong `state`) or one with neither a
 * code nor an error is rejected.
 */
export const readCustomerAgentCallback = (
  url: string,
  expectedState: string
): CustomerAgentCallback => {
  if (!isCustomerAgentCallbackUrl(url)) {
    throw new Error("The browser is not on the agent's redirect URI");
  }
  const { searchParams } = new URL(url);
  if (searchParams.get("state") !== expectedState) {
    throw new Error("The authorization response carries another state");
  }
  const error = searchParams.get("error");
  if (error) return { error, kind: "error" };
  const code = searchParams.get("code");
  if (!code) {
    throw new Error("The authorization response has neither code nor error");
  }
  const iss = searchParams.get("iss");
  return iss ? { code, iss, kind: "code" } : { code, kind: "code" };
};
