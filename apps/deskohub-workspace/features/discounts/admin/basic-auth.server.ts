import "server-only";

import { Data, Effect } from "effect";
import { headers } from "next/headers";
import { env } from "@/env";
import { isDiscountAdminAuthorizationValid } from "./basic-auth";

export class DiscountAdminUnauthorizedError extends Data.TaggedError(
  "DiscountAdminUnauthorizedError"
)<{
  readonly message: string;
}> {}

export const requireDiscountAdminAuthorization = Effect.fn(
  "DiscountAdmin.requireAuthorization"
)(() =>
  Effect.tryPromise({
    try: () => headers(),
    catch: () =>
      new DiscountAdminUnauthorizedError({
        message: "Administrator authentication is required.",
      }),
  }).pipe(
    Effect.filterOrFail(
      (requestHeaders) =>
        isDiscountAdminAuthorizationValid(
          requestHeaders.get("authorization"),
          env.ADMIN_BASIC_AUTH_SHA256
        ),
      () =>
        new DiscountAdminUnauthorizedError({
          message: "Administrator authentication is required.",
        })
    ),
    Effect.asVoid
  )
);
