import { headers } from "next/headers";
import { extractLocaleFromRequest } from "../paraglide/runtime";

export async function getLocaleFromServer() {
  const h = await headers();

  const fauxRequest = {
    url: h.get("referer") || "/",
    headers: h,
  } satisfies Partial<Request> as Request;

  return extractLocaleFromRequest(fauxRequest);
}
