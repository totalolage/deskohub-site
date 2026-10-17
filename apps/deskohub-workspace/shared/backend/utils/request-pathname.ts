import { headers } from "next/headers";
import type { NextRequest } from "next/server";

const requestPathnameHeader = "x-deskohub-request-pathname";

/**
 * The request's headers for its render, carrying the requested pathname. The
 * proxy sets it, replacing any value the client sent.
 */
export const withRequestPathname = (request: NextRequest) => {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(requestPathnameHeader, request.nextUrl.pathname);
  return requestHeaders;
};

/**
 * The pathname of the request being rendered, for a layout that must know
 * which of its pages renders below it; a layout receives no child params. Only
 * requests the proxy hands it to carry one, so it is undefined elsewhere.
 */
export const getRequestPathname = async () =>
  (await headers()).get(requestPathnameHeader) ?? undefined;
