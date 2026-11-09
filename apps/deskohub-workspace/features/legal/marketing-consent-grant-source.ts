/**
 * Where a customer gave their marketing consent: the reservation form's
 * checkbox, a browser assistant calling the site's tools, a customer's AI
 * agent calling the customer MCP server, account settings, the signed email
 * link, or the customer's native app through the customer HTTP API. Stored
 * grants keep their value even if a channel is later removed.
 */
export const marketingConsentGrantSources = [
  "reservation_form",
  "site_tool",
  "mcp_tool",
  "account",
  "link",
  "customer_app",
] as const;

export type MarketingConsentGrantSource =
  (typeof marketingConsentGrantSources)[number];
