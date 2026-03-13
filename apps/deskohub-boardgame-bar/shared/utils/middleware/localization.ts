import {
  getLocalizedRedirectPathname,
  shouldRedirectForMissingLocale,
} from "@deskohub/i18n/next";
import { NextResponse } from "next/server";
import { extractLocaleFromRequest, locales } from "@/features/i18n";
import type { MiddlewareFactory } from "@/shared/utils/middleware-chain";

export const localizationMiddleware: MiddlewareFactory =
  (next) => async (req, event, incomingResponse) => {
    if (!shouldRedirectForMissingLocale(req.nextUrl.pathname, locales)) {
      return next(req, event, incomingResponse);
    }

    const locale = extractLocaleFromRequest(req);
    const localizedPath = getLocalizedRedirectPathname(
      req.nextUrl.pathname,
      locale,
      locales
    );
    const redirectUrl = new URL(localizedPath, req.url);
    return NextResponse.redirect(redirectUrl);
  };
