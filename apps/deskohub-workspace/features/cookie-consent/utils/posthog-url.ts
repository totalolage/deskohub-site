const SENSITIVE_QUERY_PARAMS = new Set([
  "checkouttoken",
  "paystate",
  "paystateref",
  "token",
  "state",
  "secret",
]);

export function createPostHogPageUrl(href: string) {
  const url = new URL(href);

  for (const param of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.has(param.toLowerCase())) {
      url.searchParams.delete(param);
    }
  }

  return url.toString();
}
