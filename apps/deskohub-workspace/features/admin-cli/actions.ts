"use server";

import {
  CliAuthenticationCode,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Predicate, Schema, SchemaGetter } from "effect";
import { redirect } from "next/navigation";
import {
  administrationHref,
  localizeAdministrationHref,
} from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import { resolveActionLocale } from "@/features/i18n/server/action-locale";
import type { WorkspaceActionFailureCopy } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CliAuthentication } from "./cli-authentication.service";
import {
  cliSessionDurationFieldsSchema,
  cliSessionLifetimeSchema,
  renameCliSessionStandardSchema,
} from "./contracts";

const strict = { errors: "all", onExcessProperty: "error" } as const;

const failureCopy: WorkspaceActionFailureCopy = {
  timeout: m.adminCliActionTimedOut,
  unexpected: m.adminCliActionFailedUnexpectedly,
};

const sessionsPath = () => [administrationHref("/[locale]/admin/cli/sessions")];

const { Duration, Never } = cliSessionLifetimeSchema.cases;

const approvalFieldsSchema = Schema.Struct({
  code: CliAuthenticationCode,
  sessionLifetime: Schema.Union([
    Never,
    cliSessionDurationFieldsSchema.pipe(
      Schema.decodeTo(Duration, {
        decode: SchemaGetter.transform((fields) => Duration.make(fields)),
        encode: SchemaGetter.transform(({ amount, unit }) => ({
          amount,
          unit,
        })),
      })
    ),
  ]),
});

// The form actions pass submitted values, which the schemas validate.
const approvalSchema: StandardSchemaV1<
  unknown,
  typeof approvalFieldsSchema.Type
> = Schema.toStandardSchemaV1(approvalFieldsSchema, { parseOptions: strict });

const revocationFieldsSchema = Schema.Struct({ sessionId: CliSessionId });

const revocationSchema: StandardSchemaV1<
  unknown,
  typeof revocationFieldsSchema.Type
> = Schema.toStandardSchemaV1(revocationFieldsSchema, {
  parseOptions: strict,
});

const approveCliAuthenticationAction = defineAdministrationAction(
  {
    operation: "cli-authentication.approve",
    failureCopy,
    schema: approvalSchema,
    // The code authenticates the waiting CLI.
    logInput: false,
    capabilities: CliAuthentication.Live,
  },
  Effect.fn(function* (input) {
    const approvedBy = yield* CurrentAdministrator;
    const authentication = yield* CliAuthentication;
    return yield* authentication.approve({ ...input, approvedBy });
  })
);

/** Approves the CLI request the form names, then shows the outcome. */
export async function approveCliAuthentication(formData: FormData) {
  const code = formData.get("code");
  const approval = await approveCliAuthenticationAction({
    code,
    sessionLifetime:
      formData.get("neverExpire") === "on"
        ? Never.make({})
        : {
            amount: formData.get("lifetimeAmount"),
            unit: formData.get("lifetimeUnit"),
          },
  });

  const search = new URLSearchParams({
    code: Predicate.isString(code) ? code : "",
    result: approval.data === undefined ? "error" : "approved",
  });
  redirect(
    localizeAdministrationHref(
      `${administrationHref("/[locale]/admin/cli/authenticate")}?${search}`,
      await resolveActionLocale()
    )
  );
}

const revokeCliSessionAction = defineAdministrationAction(
  {
    operation: "cli-authentication.revoke",
    failureCopy,
    schema: revocationSchema,
    capabilities: CliAuthentication.Live,
    revalidates: sessionsPath,
  },
  Effect.fn(function* (input) {
    const administrator = yield* CurrentAdministrator;
    const authentication = yield* CliAuthentication;
    return {
      revoked: yield* authentication.revoke({
        owner: administrator.accountId,
        sessionId: input.sessionId,
      }),
    };
  })
);

/** Revokes one of the administrator's own CLI sessions, then shows the outcome. */
export async function revokeCliSession(formData: FormData) {
  const revocation = await revokeCliSessionAction({
    sessionId: formData.get("sessionId"),
  });

  const search = new URLSearchParams({
    result: revocation.data?.revoked === true ? "revoked" : "unchanged",
  });
  redirect(
    localizeAdministrationHref(
      `${administrationHref("/[locale]/admin/cli/sessions")}?${search}`,
      await resolveActionLocale()
    )
  );
}

const renameCliSessionAction = defineAdministrationAction(
  {
    operation: "cli-authentication.rename-session",
    schema: renameCliSessionStandardSchema,
    failureCopy,
    fallback: m.adminCliRenameFailed,
    capabilities: CliAuthentication.Live,
    revalidates: sessionsPath,
  },
  Effect.fn(function* (input, { locale }) {
    const administrator = yield* CurrentAdministrator;
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
    return { notice: m.adminCliRenameSaved({}, { locale }) };
  })
);

export const renameCliSession: typeof renameCliSessionAction = async (
  ...args: Parameters<typeof renameCliSessionAction>
) => {
  "use server";
  return await renameCliSessionAction(...args);
};
