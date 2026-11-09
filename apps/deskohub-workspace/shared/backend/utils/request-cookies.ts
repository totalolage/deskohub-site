import "server-only";

import { Data, Effect } from "effect";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";

class RequestCookiesError extends Data.TaggedError("RequestCookiesError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * The current request's cookies. Next.js control flow, such as a prerender
 * that can't read the request, propagates unchanged.
 */
export const getRequestCookies = Effect.tryPromise({
  try: () => cookies(),
  catch: (cause) => {
    unstable_rethrow(cause);
    return new RequestCookiesError({
      message: "Could not load the current request cookies.",
      cause,
    });
  },
}).pipe(Effect.withSpan("getRequestCookies"));
