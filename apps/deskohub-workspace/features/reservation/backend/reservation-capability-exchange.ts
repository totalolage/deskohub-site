import { setLocaleCookie } from "@deskohub/i18n/next";
import { Effect, Option, Schema } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import type { Locale } from "@/features/i18n";
import { localeCookieName } from "@/features/i18n/routing";
import {
  reservationAccessTokenQueryParam,
  reservationAccessTokenSchema,
} from "@/features/reservation/reservation-access-token";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { markPrivateResponse } from "@/shared/utils/private-response";
import {
  createReservationAccessCookieCapability,
  parseCanonicalReservationAccessUrl,
  parseCanonicalReservationStatusUrl,
  writeReservationAccessCookie,
} from "./reservation-access-cookie";
import { openReservationAccessToken } from "./reservation-access-token";

/**
 * Exchanges the access token in a reservation link for an access cookie and
 * redirects to the same page without the token. Rejects malformed, ambiguous,
 * or invalid tokens with a private 404.
 *
 * Callers only invoke this for GET requests to a status or access page that
 * carry the access token query parameter.
 */
export const exchangeReservationCapability = (
  request: NextRequest,
  locale: Locale
): Promise<NextResponse> =>
  exchange(request, locale).pipe(
    runWorkspaceEffect("reservation.access.exchange", { boundary: "route" })
  );

const exchange = (
  request: NextRequest,
  locale: Locale
): Effect.Effect<NextResponse> => {
  const accessTokens = request.nextUrl.searchParams.getAll(
    reservationAccessTokenQueryParam
  );
  if (accessTokens.length !== 1) return Effect.succeed(reject());
  const accessTokenValue = accessTokens[0];
  if (!accessTokenValue) return Effect.succeed(reject());

  const accessToken = Option.getOrUndefined(
    Schema.decodeOption(reservationAccessTokenSchema)(accessTokenValue)
  );
  if (!accessToken) return Effect.succeed(reject());

  const cleanUrl = request.nextUrl.clone();
  cleanUrl.searchParams.delete(reservationAccessTokenQueryParam);
  const pathWithCapabilityExchangeParams = `${cleanUrl.pathname}${cleanUrl.search}`;
  const orderId =
    parseCanonicalReservationStatusUrl(
      pathWithCapabilityExchangeParams,
      locale
    ) ??
    parseCanonicalReservationAccessUrl(
      pathWithCapabilityExchangeParams,
      locale
    );
  if (!orderId) return Effect.succeed(reject());

  cleanUrl.searchParams.delete("x-vercel-protection-bypass");
  cleanUrl.searchParams.delete("x-vercel-set-bypass-cookie");
  const cleanPath = `${cleanUrl.pathname}${cleanUrl.search}`;

  return Effect.gen(function* () {
    const tokenClaims = yield* openReservationAccessToken({
      token: accessToken,
      orderId,
      locale,
    });
    const response = NextResponse.redirect(new URL(cleanPath, request.url));
    const capability = yield* createReservationAccessCookieCapability({
      orderId,
      locale: tokenClaims.locale,
    });
    yield* writeReservationAccessCookie(response.cookies, {
      orderId,
      capability,
    });
    setLocaleCookie(response, localeCookieName, locale);
    return markPrivateResponse(response);
  }).pipe(Effect.catch(() => Effect.succeed(reject())));
};

const reject = () =>
  markPrivateResponse(new NextResponse(null, { status: 404 }));
