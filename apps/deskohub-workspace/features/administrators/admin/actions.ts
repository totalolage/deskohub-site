"use server";

import { Effect } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import {
  PublicSafeActionError,
  type SafeActionFailure,
} from "@/shared/utils/safe-action-client";
import { AdministratorRoster } from "../backend/administrator-roster.service";
import { requireAdministratorAuthorization } from "../server/administrator-authorization.server";
import {
  grantAdministratorStandardSchema,
  revokeAdministratorStandardSchema,
} from "./contracts";

const administratorsPath = "/admin/administrators";

const grantAdministratorAction = defineWorkspaceAction(
  {
    operation: "administrators.grant",
    schema: grantAdministratorStandardSchema,
    logInput: false,
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
        ),
        Effect.mapError(toPublicError(locale, m.administratorsGrantFailed))
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
        ),
        Effect.mapError(toPublicError(locale, m.administratorsRevokeFailed))
      )
  )
);

export const revokeAdministrator: typeof revokeAdministratorAction = async (
  ...args: Parameters<typeof revokeAdministratorAction>
) => {
  "use server";
  return await revokeAdministratorAction(...args);
};

// Keeps a public error as it is and hides every other failure, including a
// missing grant, behind the operation's generic message.
const toPublicError =
  (locale: Locale, message: typeof m.administratorsGrantFailed) =>
  (cause: SafeActionFailure) =>
    cause instanceof PublicSafeActionError
      ? cause
      : new PublicSafeActionError({
          message: message({}, { locale }),
          cause,
        });
