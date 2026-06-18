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

  for (const param of SENSITIVE_QUERY_PARAMS) {
    url.searchParams.delete(param);
  }

  return url.toString();
}
