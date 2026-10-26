"use server";

import { Effect } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import {
  defineWorkspaceAction,
  type WorkspaceActionFailureCopy,
} from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { AdministratorRoster } from "../backend/administrator-roster.service";
import { requireAdministratorAuthorization } from "../server/administrator-authorization.server";
import {
  grantAdministratorStandardSchema,
  revokeAdministratorStandardSchema,
} from "./contracts";

const administratorsPath = administrationHref("/[locale]/admin/administrators");

const failureCopy: WorkspaceActionFailureCopy = {
  timeout: m.administratorsActionTimedOut,
  unexpected: m.administratorsActionFailedUnexpectedly,
};

const grantAdministratorAction = defineWorkspaceAction(
  {
    operation: "administrators.grant",
    schema: grantAdministratorStandardSchema,
    logInput: false,
    failureCopy,
    // A missing grant and every other failure read as the operation failing.
    fallback: m.administratorsGrantFailed,
  },
  Effect.fn(
    function* (input, _context) {
      const actor = yield* requireAdministratorAuthorization;
      const roster = yield* AdministratorRoster;
      const granted = yield* roster.grant({ email: input.email, actor });
      yield* Effect.sync(() => revalidateLocalizedPath(administratorsPath));
      return granted;
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(AdministratorRoster.Live),
        Effect.catchTag("AdministratorAccountNotFoundError", (cause) =>
          Effect.fail(
            new PublicSafeActionError({
              message: m.administratorsGrantAccountNotFound({}, { locale }),
              cause,
            })
          )
        )
      )
  )
);

export const grantAdministrator: typeof grantAdministratorAction = async (
  ...args: Parameters<typeof grantAdministratorAction>
) => {
  "use server";
  return await grantAdministratorAction(...args);
};

const revokeAdministratorAction = defineWorkspaceAction(
  {
    operation: "administrators.revoke",
    schema: revokeAdministratorStandardSchema,
    failureCopy,
    fallback: m.administratorsRevokeFailed,
  },
  Effect.fn(
    function* (input, _context) {
      const actor = yield* requireAdministratorAuthorization;
      const roster = yield* AdministratorRoster;
      const revoked = yield* roster.revoke({
        accountId: input.accountId,
        actor,
      });
      yield* Effect.sync(() => revalidateLocalizedPath(administratorsPath));
      return revoked;
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(AdministratorRoster.Live),
        Effect.catchTag("AdministratorSelfRevocationError", (cause) =>
          Effect.fail(
            new PublicSafeActionError({
              message: m.administratorsRevokeSelf({}, { locale }),
              cause,
            })
          )
        )
      )
  )
);

export const revokeAdministrator: typeof revokeAdministratorAction = async (
  ...args: Parameters<typeof revokeAdministratorAction>
) => {
  "use server";
  return await revokeAdministratorAction(...args);
};
