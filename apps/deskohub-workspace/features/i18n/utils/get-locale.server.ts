import { headers } from "next/headers";
import { extractLocaleFromRequest } from "../paraglide/runtime.js";

export async function getLocaleFromServer() {
  const requestHeaders = await headers();
  const referer = requestHeaders.get("referer");
  if (!referer) return undefined;

  return extractLocaleFromRequest({
    url: referer,
    headers: requestHeaders,
  } satisfies Partial<Request> as Request);
}
