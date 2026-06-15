import { headers } from "next/headers";
import { extractLocaleFromRequest } from "../paraglide/runtime.js";

export async function getLocaleFromServer() {
  const requestHeaders = await headers();
  const requestLike = {
    url: requestHeaders.get("referer") || "/",
    headers: requestHeaders,
  } satisfies Partial<Request> as Request;

  return extractLocaleFromRequest(requestLike);
}
