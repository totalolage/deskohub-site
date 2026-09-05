"use server";

import { CliSessionId } from "@deskohub/workspace-admin-api";
import { Effect, Predicate, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdministratorAuthorization } from "@/shared/administrator/administrator-authorization.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CliAuthentication } from "./cli-authentication.service";
import { renameCliSessionStandardSchema } from "./contracts";
import { decodeCliAuthenticationCode } from "./page-data.server";

export async function approveCliAuthentication(formData: FormData) {
  const rawCode = formData.get("code");
  const codeForRedirect = Predicate.isString(rawCode) ? rawCode : "";

  const approved = await Effect.gen(function* () {
    const approvedBy = yield* requireAdministratorAuthorization;
    const code = yield* decodeCliAuthenticationCode(rawCode);
    const authentication = yield* CliAuthentication;
    return yield* authentication.approve({ approvedBy, code });
  }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
    Effect.provide(CliAuthentication.Live),
    runWorkspaceEffect("cli-authentication.approve", { boundary: "action" })
  );

  const search = new URLSearchParams({
    code: codeForRedirect,
    result: approved ? "approved" : "error",
  });
  redirect(`/admin/cli/authenticate?${search}`);
}

export async function revokeCliSession(formData: FormData) {
  const revoked = await Effect.gen(function* () {
    const owner = yield* requireAdministratorAuthorization;
    const sessionId = yield* Schema.decodeUnknownEffect(CliSessionId)(
      formData.get("sessionId")
    );
    const authentication = yield* CliAuthentication;
    return yield* authentication.revoke({ owner, sessionId });
  }).pipe(
    Effect.catch(() => Effect.succeed(false)),
    Effect.provide(CliAuthentication.Live),
    runWorkspaceEffect("cli-authentication.revoke", { boundary: "action" })
  );

  revalidatePath("/admin/cli/sessions");
  const search = new URLSearchParams({
    result: revoked ? "revoked" : "unchanged",
  });
  redirect(`/admin/cli/sessions?${search}`);
}

const renameCliSessionAction = defineWorkspaceAction(
  {
    operation: "cli-authentication.rename-session",
    schema: renameCliSessionStandardSchema,
  },
  (input) =>
    Effect.gen(function* () {
      const owner = yield* requireAdministratorAuthorization;
      const authentication = yield* CliAuthentication;
      const renamed = yield* authentication.renameSession({
        owner,
        sessionId: input.sessionId,
        clientName: input.clientName,
      });
      if (!renamed) {
        return yield* new PublicSafeActionError({
          message: "That CLI session no longer exists.",
        });
      }
      yield* Effect.sync(() => revalidatePath("/admin/cli/sessions"));
      return { notice: "CLI session label updated." };
    }).pipe(
      Effect.provide(CliAuthentication.Live),
      Effect.mapError((cause) =>
        cause instanceof PublicSafeActionError
          ? cause
          : new PublicSafeActionError({
              message: "The CLI session label could not be updated.",
              cause,
            })
      )
    )
);

export const renameCliSession: typeof renameCliSessionAction = async (
  ...args: Parameters<typeof renameCliSessionAction>
) => {
  "use server";
  return await renameCliSessionAction(...args);
};
