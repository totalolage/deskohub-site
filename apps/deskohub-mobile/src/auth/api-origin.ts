/**
 * The Workspace host the app talks to. Native builds read
 * `EXPO_PUBLIC_API_ORIGIN` (a development build may point at a preview or a
 * tunnel) and default to production; the web bundle is served by the
 * Workspace itself, so it defaults to the origin that served it and keeps the
 * session cookie same-origin.
 */
export const productionApiOrigin = "https://workspace.deskohub.cz";

const plainHttpHosts = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

export const resolveApiOrigin = (
  configured: string | undefined,
  servingOrigin: string | undefined
): string => {
  const candidate = configured?.trim() || servingOrigin || productionApiOrigin;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      `EXPO_PUBLIC_API_ORIGIN must be an absolute http(s) URL, got ${JSON.stringify(candidate)}.`
    );
  }
  if (url.protocol === "https:") {
    return url.origin;
  }
  if (url.protocol === "http:" && plainHttpHosts.has(url.hostname)) {
    return url.origin;
  }
  throw new Error(
    `EXPO_PUBLIC_API_ORIGIN must use https (plain http only for a local host), got ${JSON.stringify(candidate)}.`
  );
};
