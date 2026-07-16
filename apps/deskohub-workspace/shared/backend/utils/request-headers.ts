import "server-only";

import { Data, Effect } from "effect";
import { headers } from "next/headers";

export class RequestHeadersError extends Data.TaggedError(
  "RequestHeadersError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export const getRequestHeaders = Effect.fn("getRequestHeaders")(() =>
  Effect.tryPromise({
    try: () => headers(),
    catch: (cause) =>
      new RequestHeadersError({
        message: "Could not load the current request headers.",
        cause,
      }),
  })
);
