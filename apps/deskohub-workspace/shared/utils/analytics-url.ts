const SENSITIVE_QUERY_PARAMS = new Set([
  "checkouttoken",
  "accesstoken",
  "invoiceid",
  "orderid",
  "paystate",
  "paystateref",
  "reservationid",
  "secret",
  "state",
  "statustoken",
  "token",
  "x-vercel-protection-bypass",
]);

const OPERATIONAL_PATH_PATTERN =
  /(\/(?:reservation\/(?:status|access|invoice)|checkout\/pay\/return|invoices?|orders?)\/)[^/]+/g;

export function sanitizeAnalyticsUrl(href: string) {
  const url = new URL(href);
  url.pathname = url.pathname.replace(OPERATIONAL_PATH_PATTERN, "$1[id]");

  for (const param of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.has(param.toLowerCase())) {
      url.searchParams.delete(param);
    }
  }

  return url.toString();
}
