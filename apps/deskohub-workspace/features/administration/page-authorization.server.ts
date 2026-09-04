import "server-only";

import { Effect } from "effect";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { requireAdministrationAuthorization } from "./basic-auth.server";

export const authorizeAdministrationPage = cache(async () => {
  await connection();
  const authorized = await requireAdministrationAuthorization().pipe(
    Effect.as(true),
    Effect.catchTag("AdministrationUnauthorizedError", () =>
      Effect.succeed(false)
    ),
    runWorkspaceEffect("administration.authorize-page", { boundary: "route" })
  );
  if (!authorized) notFound();
});
