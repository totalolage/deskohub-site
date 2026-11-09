import { cookies, headers } from "next/headers";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { resolveWorkspaceLocale } from "../locale-resolution";
import type { Locale } from "../paraglide/runtime.js";
import { pageLocalePreference } from "./page-locale-preference.server";

/**
 * The locale of a Server Action: the Workspace locale chain applied to the
 * page that invoked it. A page continuing a flow bound to its issued locale
 * keeps that locale, as the proxy keeps it for the page itself.
 */
export async function resolveActionLocale(): Promise<Locale> {
  const [requestHeaders, requestCookies] = await Promise.all([
    headers(),
    cookies(),
  ]);
  const referringPage = URL.parse(requestHeaders.get("referer") ?? "");

  return resolveWorkspaceLocale(
    {
      pathname: referringPage?.pathname,
      cookies: requestCookies,
      headers: requestHeaders,
    },
    await pageLocalePreference(requestHeaders, referringPage ?? undefined).pipe(
      runWorkspaceEffect("i18n.action-locale", { boundary: "action" })
    )
  );
}
