import "server-only";

import { Data, Effect } from "effect";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getAccountSignInPath } from "@/features/account/routes";
import { defaultLocale, isLocale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";
import type { AdministratorAccountActor } from "../account-role";
import { administrationRequestPathHeader } from "../administration-request-path";
import { currentAdministratorAccess } from "../backend/current-administrator";
import { administratorAccessLayer } from "./administrator-access-layer.server";

class AdministratorUnauthorizedError extends Data.TaggedError(
  "AdministratorUnauthorizedError"
)<{
  readonly message: string;
}> {}

const unauthorized = () =>
  new AdministratorUnauthorizedError({
    message: "Administrator authentication is required.",
  });

const administratorAccess = currentAdministratorAccess.pipe(
  Effect.provide(administratorAccessLayer)
);

/**
 * The administrator account a Server Action or route acts as. Anything but a
 * verified session whose account holds the grant fails closed with
 * `AdministratorUnauthorizedError` and never redirects, so a Server Action
 * can't loop through sign-in. Session or database failures fail the same
 * way after a log line.
 */
export const requireAdministratorAuthorization: Effect.Effect<
  AdministratorAccountActor,
  AdministratorUnauthorizedError
> = administratorAccess.pipe(
  Effect.tapError(() =>
    Effect.logWarning("Administrator authorization failed closed.")
  ),
  Effect.orElseSucceed(() => ({ kind: "not-administrator" }) as const),
  Effect.flatMap((access) =>
    access.kind === "administrator"
      ? Effect.succeed(access.actor)
      : Effect.fail(unauthorized())
  ),
  Effect.withSpan("Administrator.requireAuthorization")
);

const signInPathForRequest = async () => {
  const returnPath = parseSameOriginPath(
    (await headers()).get(administrationRequestPathHeader)
  );
  const [firstSegment] = (returnPath ?? "").split("/").slice(1, 2);
  return getAccountSignInPath(
    firstSegment !== undefined && isLocale(firstSegment)
      ? firstSegment
      : defaultLocale,
    returnPath
  );
};

/**
 * Guards an administration page or page-data loader, once per request.
 * A signed-out visitor goes to sign-in and comes back to the page; a
 * signed-in account without the grant gets the ordinary 404.
 */
export const authorizeAdministratorPage = cache(
  async (): Promise<AdministratorAccountActor> => {
    await connection();
    const access = await administratorAccess.pipe(
      runWorkspaceEffect("administrator.authorize", { boundary: "route" })
    );

    if (access.kind === "signed-out") {
      redirect(await signInPathForRequest());
    }
    if (access.kind === "not-administrator") {
      notFound();
    }
    return access.actor;
  }
);
