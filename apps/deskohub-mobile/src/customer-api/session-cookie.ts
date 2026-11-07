import { HttpClientRequest } from "effect/unstable/http";

/**
 * The origin Better Auth trusts for native cookie-authenticated mutations
 * (the Expo server plugin turns this header into `Origin`).
 */
export const nativeAuthOrigin = "deskohub://";

// The typed clients run caller transforms before they prepend the base URL,
// so a relative URL here is one the client will send to the API origin.
const isForApiOrigin = (
  request: HttpClientRequest.HttpClientRequest,
  apiOrigin: string
) =>
  URL.canParse(request.url, apiOrigin) &&
  new URL(request.url, apiOrigin).origin === apiOrigin;

/**
 * Attaches the stored session cookie, but only to requests for the API
 * origin: the cookie never leaves for another host, even if a URL is wrong.
 */
export const withSessionCookie =
  (apiOrigin: string, cookie: string) =>
  (
    request: HttpClientRequest.HttpClientRequest
  ): HttpClientRequest.HttpClientRequest =>
    cookie !== "" && isForApiOrigin(request, apiOrigin)
      ? HttpClientRequest.setHeader(request, "cookie", cookie)
      : request;

const readMethods = new Set(["GET", "HEAD"]);

/**
 * Marks a Better Auth mutation for the API origin with the native app's
 * trusted origin. Reads, and customer API requests (which must carry no
 * origin), go without it.
 */
export const withNativeAuthOrigin =
  (apiOrigin: string) =>
  (
    request: HttpClientRequest.HttpClientRequest
  ): HttpClientRequest.HttpClientRequest =>
    !readMethods.has(request.method) && isForApiOrigin(request, apiOrigin)
      ? HttpClientRequest.setHeader(request, "expo-origin", nativeAuthOrigin)
      : request;
