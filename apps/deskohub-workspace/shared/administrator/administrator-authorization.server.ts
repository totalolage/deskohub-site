import "server-only";

import { Data, Effect } from "effect";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { env } from "@/env";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { getConfiguredAdministratorAuthorizationUsername } from "./administrator-basic-auth";

export class AdministratorUnauthorizedError extends Data.TaggedError(
  "AdministratorUnauthorizedError"
)<{
  readonly message: string;
}> {}

export const requireAdministratorAuthorization = Effect.fn(
  "Administrator.requireAuthorization"
)(() =>
  Effect.tryPromise({
    try: () => headers(),
    catch: () => unauthorized(),
  }).pipe(
    Effect.flatMap((requestHeaders) => {
      const username = getConfiguredAdministratorAuthorizationUsername(
        requestHeaders.get("authorization"),
        env.ADMIN_BASIC_AUTH_CREDENTIALS
      );
      return username === null
        ? Effect.fail(unauthorized())
        : Effect.succeed(username);
    })
  )
);

export const authorizeAdministratorPage = cache(async () => {
  const username = await requireAdministratorAuthorization().pipe(
    Effect.catchTag("AdministratorUnauthorizedError", () =>
      Effect.succeed(null)
    ),
    runWorkspaceEffect("administrator.authorize", { boundary: "route" })
  );

  if (username === null) {
    notFound();
  }
  await connection();
  return username;
});

const unauthorized = () =>
  new AdministratorUnauthorizedError({
    message: "Administrator authentication is required.",
  });
