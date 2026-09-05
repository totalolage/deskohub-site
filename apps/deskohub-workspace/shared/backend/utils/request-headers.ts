import "server-only";

import { Data, Effect } from "effect";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

export class RequestHeadersError extends Data.TaggedError(
  "RequestHeadersError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export const getRequestHeaders = Effect.tryPromise({
  try: () => headers(),
  catch: (cause) => {
    unstable_rethrow(cause);
    return new RequestHeadersError({
      message: "Could not load the current request headers.",
      cause,
    });
  },
}).pipe(Effect.withSpan("getRequestHeaders"));
