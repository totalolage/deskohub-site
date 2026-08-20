import "server-only";

import { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import { Data, Effect, Schema } from "effect";
import { headers } from "next/headers";
import { env } from "@/env";
import { getDiscountAdminAuthorizationUsername } from "./basic-auth";

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
    Effect.flatMap((requestHeaders) => {
      const username = getDiscountAdminAuthorizationUsername(
        requestHeaders.get("authorization"),
        env.ADMIN_BASIC_AUTH_SHA256
      );
      return username === null
        ? Effect.fail(unauthorized())
        : Schema.decodeUnknownEffect(AdministrationActorUsername)(
            username
          ).pipe(Effect.mapError(unauthorized));
    })
  )
);

const unauthorized = () =>
  new DiscountAdminUnauthorizedError({
    message: "Administrator authentication is required.",
  });
