export function buildMobileApiUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const url = new URL(path, base.origin);
  for (const [name, value] of base.searchParams)
    url.searchParams.append(name, value);
  return url;
}
