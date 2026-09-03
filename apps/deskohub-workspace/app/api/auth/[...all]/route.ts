import { auth } from "@/features/account/server/auth.server";

/**
 * The official Better Auth GET/POST handler. Better Auth resolves the
 * endpoint from the request URL, so the catch-all context is not forwarded.
 * Every response is forced to private, no-store: redirects and Set-Cookie
 * headers are preserved, caching is not.
 */
const handleAuthRequest = async (request: Request): Promise<Response> => {
  const response = await auth.handler(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
