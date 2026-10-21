/**
 * Where a customer gave their marketing consent: the reservation form's
 * checkbox, a browser assistant calling the site's tools, a customer's AI
 * agent calling the customer MCP server, account settings, or the signed email
 * link. Stored grants keep their value even if a channel is later removed.
 */
export const marketingConsentGrantSources = [
  "reservation_form",
  "site_tool",
  "mcp_tool",
  "account",
  "link",
] as const;

export type MarketingConsentGrantSource =
  (typeof marketingConsentGrantSources)[number];
