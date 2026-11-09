export function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

/**
 * Whether a parsed URL's `hostname` names the visitor's own machine:
 * `localhost` and its RFC 6761 subdomains, IPv4 127.0.0.0/8, or IPv6 `::1`.
 * Pass `URL.hostname`, which already spells IP addresses canonically, so
 * `127.1` arrives as `127.0.0.1` and `[0::1]` as `[::1]`.
 */
export function isLoopbackHostname(hostname: string) {
  const host = normalizeHostname(hostname);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}
