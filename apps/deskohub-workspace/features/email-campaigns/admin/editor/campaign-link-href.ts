const campaignLinkProtocols: ReadonlySet<string> = new Set([
  "https:",
  "mailto:",
]);

const completeCampaignLinkHref = (value: string) => {
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  if (/^[^\s/@]+@[^\s/@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
};

/**
 * Completes what an admin types into a link field: a bare address becomes
 * `mailto:` and a bare host becomes `https:`. Returns `undefined` when the
 * result still isn't an https: or mailto: URL, which campaign bodies reject.
 */
export const normalizeCampaignLinkHref = (input: string) => {
  const href = completeCampaignLinkHref(input.trim());
  return campaignLinkProtocols.has(URL.parse(href)?.protocol ?? "")
    ? href
    : undefined;
};
