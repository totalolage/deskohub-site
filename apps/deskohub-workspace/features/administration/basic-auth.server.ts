import "server-only";

import { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import { Data, Effect, Schema } from "effect";
import { headers } from "next/headers";
import { env } from "@/env";
import { getAdministrationAuthorizationUsername } from "./basic-auth";

export class AdministrationUnauthorizedError extends Data.TaggedError(
  "AdministrationUnauthorizedError"
)<{
  readonly message: string;
}> {}

export const requireAdministrationAuthorization = Effect.fn(
  "Administration.requireAuthorization"
)(() =>
  Effect.tryPromise({
    try: () => headers(),
    catch: () =>
      new AdministrationUnauthorizedError({
        message: "Administrator authentication is required.",
      }),
  }).pipe(
    Effect.flatMap((requestHeaders) => {
      const username = getAdministrationAuthorizationUsername(
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
  new AdministrationUnauthorizedError({
    message: "Administrator authentication is required.",
  });
