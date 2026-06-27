import { NextResponse } from "next/server";
import { locales } from "@/features/i18n";
import type { MiddlewareFactory } from "@/shared/utils/middleware-chain";
import { createMiddlewareChain } from "@/shared/utils/middleware-chain";
import { localizationMiddleware } from "./localization";
import { pathHeaderMiddleware } from "./path-header";

const workspaceOrigin = "https://workspace.deskohub.cz";
const trainingRoomPath = "/training-room";
const trainingRoomReservationPath = `${trainingRoomPath}/reservation`;

const trainingRoomRedirectMiddleware: MiddlewareFactory =
  (next) => (request, event, response) => {
    const redirectTarget = getTrainingRoomRedirectTarget(
      request.nextUrl.pathname
    );

    if (!redirectTarget) return next(request, event, response);

    const targetUrl = new URL(redirectTarget.pathname, workspaceOrigin);
    if (redirectTarget.keepSearch) targetUrl.search = request.nextUrl.search;

    return NextResponse.redirect(targetUrl, 308);
  };

function getTrainingRoomRedirectTarget(pathname: string) {
  if (matchesPath(pathname, trainingRoomPath)) {
    return {
      pathname: "/ttrpg-room",
      keepSearch: !matchesPath(pathname, trainingRoomReservationPath),
    };
  }

  for (const locale of locales) {
    const localeTrainingRoomPath = `/${locale}${trainingRoomPath}`;
    const localeTrainingRoomReservationPath = `/${locale}${trainingRoomReservationPath}`;
    if (matchesPath(pathname, localeTrainingRoomPath)) {
      return {
        pathname: `/${locale}/ttrpg-room`,
        keepSearch: !matchesPath(pathname, localeTrainingRoomReservationPath),
      };
    }
  }

  return null;
}

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default createMiddlewareChain([
  trainingRoomRedirectMiddleware,
  localizationMiddleware,
  pathHeaderMiddleware,
]);
