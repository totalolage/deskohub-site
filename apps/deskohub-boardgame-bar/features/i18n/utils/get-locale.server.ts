import { headers } from "next/headers";
import { extractLocaleFromRequest } from "../paraglide/runtime";

// Paraglide parses the request URL as an absolute URL, although Bar's compiled
// strategies (cookie, globalVariable, baseLocale) never read it. Server action
// requests carry their page URL only in the optional Referer header.
const UNKNOWN_PAGE_URL = "http://localhost/";

export async function getLocaleFromServer() {
  const requestHeaders = await headers();

  return extractLocaleFromRequest({
    url: requestHeaders.get("referer") ?? UNKNOWN_PAGE_URL,
    headers: requestHeaders,
  } satisfies Partial<Request> as Request);
}
