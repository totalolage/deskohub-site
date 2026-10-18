"use server";

import { CliSessionId } from "@deskohub/workspace-admin-api";
import { Effect, Predicate, Schema } from "effect";
import { redirect } from "next/navigation";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { resolveActionLocale } from "@/features/i18n/server/action-locale";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CliAuthentication } from "./cli-authentication.service";
import {
  cliSessionDurationFieldsSchema,
  cliSessionLifetimeSchema,
  renameCliSessionStandardSchema,
} from "./contracts";
import { decodeCliAuthenticationCode } from "./page-data.server";

export async function approveCliAuthentication(formData: FormData) {
  const rawCode = formData.get("code");
  const codeForRedirect = Predicate.isString(rawCode) ? rawCode : "";

  const approved = await Effect.gen(function* () {
    const approvedBy = yield* requireAdministratorAuthorization;
    const code = yield* decodeCliAuthenticationCode(rawCode);
    const sessionLifetime = yield* decodeCliSessionLifetime(formData);
    const authentication = yield* CliAuthentication;
    return yield* authentication.approve({
      approvedBy,
      code,
      sessionLifetime,
    });
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
  redirect(
    localizeAdministrationHref(
      `/admin/cli/authenticate?${search}`,
      await resolveActionLocale()
    )
  );
}

const decodeCliSessionLifetime = (formData: FormData) =>
  formData.get("neverExpire") === "on"
    ? Effect.succeed(cliSessionLifetimeSchema.cases.Never.make({}))
    : Schema.decodeUnknownEffect(cliSessionDurationFieldsSchema)({
        amount: formData.get("lifetimeAmount"),
        unit: formData.get("lifetimeUnit"),
      }).pipe(Effect.map(cliSessionLifetimeSchema.cases.Duration.make));

export async function revokeCliSession(formData: FormData) {
  const revoked = await Effect.gen(function* () {
    const administrator = yield* requireAdministratorAuthorization;
    const sessionId = yield* Schema.decodeUnknownEffect(CliSessionId)(
      formData.get("sessionId")
    );
    const authentication = yield* CliAuthentication;
    return yield* authentication.revoke({
      owner: administrator.accountId,
      sessionId,
    });
  }).pipe(
    Effect.catch(() => Effect.succeed(false)),
    Effect.provide(CliAuthentication.Live),
    runWorkspaceEffect("cli-authentication.revoke", { boundary: "action" })
  );

  revalidateLocalizedPath("/admin/cli/sessions");
  const search = new URLSearchParams({
    result: revoked ? "revoked" : "unchanged",
  });
  redirect(
    localizeAdministrationHref(
      `/admin/cli/sessions?${search}`,
      await resolveActionLocale()
    )
  );
}

const renameCliSessionAction = defineWorkspaceAction(
  {
    operation: "cli-authentication.rename-session",
    schema: renameCliSessionStandardSchema,
  },
  Effect.fn(
    function* (input, { locale }) {
      const administrator = yield* requireAdministratorAuthorization;
      const authentication = yield* CliAuthentication;
      const renamed = yield* authentication.renameSession({
        owner: administrator.accountId,
        sessionId: input.sessionId,
        clientName: input.clientName,
      });
      if (!renamed) {
        return yield* new PublicSafeActionError({
          message: m.adminCliRenameSessionMissing({}, { locale }),
        });
      }
      yield* Effect.sync(() => revalidateLocalizedPath("/admin/cli/sessions"));
      return { notice: m.adminCliRenameSaved({}, { locale }) };
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(CliAuthentication.Live),
        Effect.mapError((cause) =>
          cause instanceof PublicSafeActionError
            ? cause
            : new PublicSafeActionError({
                message: m.adminCliRenameFailed({}, { locale }),
                cause,
              })
        )
      )
  )
);

export const renameCliSession: typeof renameCliSessionAction = async (
  ...args: Parameters<typeof renameCliSessionAction>
) => {
  "use server";
  return await renameCliSessionAction(...args);
};
