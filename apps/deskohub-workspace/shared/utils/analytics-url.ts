const SENSITIVE_QUERY_PARAMS = new Set([
  "checkouttoken",
  "discountcodeerrorid",
  "accesstoken",
  "invoiceid",
  "orderid",
  "paystate",
  "paystateref",
  "reservationid",
  // A sign-in return target can name an admin page and its search.
  "returnto",
  "secret",
  "state",
  "statustoken",
  "token",
  "x-vercel-protection-bypass",
]);

const OPERATIONAL_PATH_PATTERN =
  /(\/(?:reservation\/(?:status|access|invoice)|checkout\/pay\/return|invoices?|orders?)\/)[^/]+/g;

/** Replaces the operational identifiers in a URL path with `[id]`. */
export const sanitizeAnalyticsPathname = (pathname: string) =>
  pathname.replace(OPERATIONAL_PATH_PATTERN, "$1[id]");

export function sanitizeAnalyticsUrl(href: string) {
  const url = new URL(href);
  url.pathname = sanitizeAnalyticsPathname(url.pathname);

  for (const param of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.has(param.toLowerCase())) {
      url.searchParams.delete(param);
    }
  }

  return url.toString();
}
