import { NextResponse } from "next/server";
import { extractLocaleFromRequest } from "@/features/i18n";
import {
  pathnameHasLocale,
  setLocaleInPathname,
} from "@/features/i18n/utils/locale-url";
import type { MiddlewareFactory } from "@/shared/utils/middleware-chain";

export const localizationMiddleware: MiddlewareFactory =
  (next) => async (req, event, incomingResponse) => {
    if (pathnameHasLocale(req.nextUrl.pathname))
      return next(req, event, incomingResponse);

    // Redirect if there is no locale in the pathname
    const locale = extractLocaleFromRequest(req);

    // For any path without locale, redirect to the user's preferred language
    const localizedPath = setLocaleInPathname(req.nextUrl.pathname, locale);
    const redirectUrl = new URL(localizedPath, req.url);
    return NextResponse.redirect(redirectUrl);
  };
