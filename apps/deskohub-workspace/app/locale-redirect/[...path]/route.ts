import { getLocalizedRedirectPathname } from "@deskohub/i18n/next";
import { type NextRequest, NextResponse } from "next/server";
import { exactLocaleRedirect } from "@/features/i18n/exact-locale-redirect";
import { resolveWorkspaceLocale } from "@/features/i18n/locale-resolution";
import { locales } from "@/features/i18n/routing";

type LocaleRedirectContext = {
  params: Promise<{ path: string[] }>;
};

// `next.config.mjs` rewrites here an unmatched dotted path outside every
// locale. It gets the redirect the proxy gives any other unprefixed path, so
// the localized catch-all answers it with the not-found page and a 404.
export async function GET(
  request: NextRequest,
  { params }: LocaleRedirectContext
) {
  const { path } = await params;
  const url = new URL(request.nextUrl);
  url.pathname = `/${path.map(encodeURIComponent).join("/")}`;

  const exactRedirect = exactLocaleRedirect(request.method, url);
  if (exactRedirect) return exactRedirect;

  url.pathname = getLocalizedRedirectPathname(
    url.pathname,
    resolveWorkspaceLocale(
      {
        pathname: url.pathname,
        cookies: request.cookies,
        headers: request.headers,
      },
      undefined
    ),
    locales
  );
  const response = NextResponse.redirect(url);
  response.headers.set("Vary", "Accept-Language");
  return response;
}
