/**
 * The Workspace serves the web app under /app/, and the native app claims the
 * same /app/ links (a magic link opened from a mail app). Expo Router applies
 * its `/app` base URL only on web, so on native an App Link arrives as
 * `/app/<route>` and matches no route. This maps it to `<route>`, keeping the
 * query and hash; anything else passes through unchanged.
 */
const webBasePath = "/app";

export const appLinkRoute = (path: string): string => {
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return path;
  }
  if (url.protocol !== "https:") return path;
  if (
    url.pathname !== webBasePath &&
    !url.pathname.startsWith(`${webBasePath}/`)
  ) {
    return path;
  }
  const route = url.pathname.slice(webBasePath.length) || "/";
  return `${route}${url.search}${url.hash}`;
};
