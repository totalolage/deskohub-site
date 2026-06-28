import {
  getLocaleFromRequestPathname,
  getLocalizedRedirectPathname,
  resolveRequestLocale,
  setLocaleCookie,
} from "@deskohub/i18n/next";
import {
  type MiddlewareConfig,
  type NextRequest,
  NextResponse,
} from "next/server";
import {
  checkoutReturnStateTokenQueryParam,
  parseCheckoutReturnStateToken,
} from "@/features/checkout/schemas/checkout-return-state-token";
import {
  localeConfig,
  localeCookieName,
  locales,
} from "@/features/i18n/routing";

const checkoutOrderPaymentOrderIdQueryParam = "paymentOrderId";
const vercelProtectionBypassQueryParam = "x-vercel-protection-bypass";
const vercelSetBypassCookieQueryParam = "x-vercel-set-bypass-cookie";

export function proxy(request: NextRequest) {
  const localeFromUrl = getLocaleFromRequestPathname(request, locales);

  if (localeFromUrl) {
    const checkoutReturnRedirect = getCheckoutOrderReturnRedirect(
      request,
      localeFromUrl
    );

    if (checkoutReturnRedirect) {
      const response = NextResponse.redirect(checkoutReturnRedirect);
      setLocaleCookie(response, localeCookieName, localeFromUrl);
      return response;
    }

    const response = NextResponse.next();
    setLocaleCookie(response, localeCookieName, localeFromUrl);
    return response;
  }

  const resolvedLocale = resolveRequestLocale({
    request,
    localeConfig: localeConfig,
    localeCookieName: localeCookieName,
  });

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = getLocalizedRedirectPathname(
    request.nextUrl.pathname,
    resolvedLocale,
    locales
  );

  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("Vary", "Accept-Language");
  setLocaleCookie(response, localeCookieName, resolvedLocale);
  return response;
}

function getCheckoutOrderReturnRedirect(request: NextRequest, locale: string) {
  if (request.nextUrl.pathname !== `/${locale}/checkout/order`) return;

  const orderId = request.nextUrl.searchParams
    .get(checkoutOrderPaymentOrderIdQueryParam)
    ?.trim();
  const checkoutToken = parseCheckoutReturnStateToken(
    request.nextUrl.searchParams.get(checkoutReturnStateTokenQueryParam) ??
      undefined
  );

  if (!orderId || !checkoutToken) return;

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = `/${locale}/checkout/status/${encodeURIComponent(orderId)}`;
  redirectUrl.search = "";
  redirectUrl.searchParams.set(
    checkoutReturnStateTokenQueryParam,
    checkoutToken
  );

  const vercelBypass = request.nextUrl.searchParams.get(
    vercelProtectionBypassQueryParam
  );

  if (vercelBypass) {
    redirectUrl.searchParams.set(
      vercelProtectionBypassQueryParam,
      vercelBypass
    );
    redirectUrl.searchParams.set(vercelSetBypassCookieQueryParam, "true");
  }

  return redirectUrl;
}

export const config: MiddlewareConfig = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|favicon.svg|.*\\..*).*)",
  ],
};
