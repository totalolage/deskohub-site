"use server";

import { Effect, Predicate } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import type { WorkspaceActionFailureCopy } from "@/shared/backend/workspace-action";
import { AdministratorRoster } from "../backend/administrator-roster.service";
import { CurrentAdministrator } from "../backend/current-administrator";
import { defineAdministrationAction } from "../server/administration-request.server";
import {
  grantAdministratorStandardSchema,
  revokeAdministratorStandardSchema,
} from "./contracts";

const administratorsPath = () => [
  administrationHref("/[locale]/admin/administrators"),
];

const failureCopy: WorkspaceActionFailureCopy = {
  timeout: m.administratorsActionTimedOut,
  unexpected: m.administratorsActionFailedUnexpectedly,
};

const grantAdministratorAction = defineAdministrationAction(
  {
    operation: "administrators.grant",
    schema: grantAdministratorStandardSchema,
    logInput: false,
    failureCopy,
    // A missing grant and every other failure read as the operation failing.
    fallback: m.administratorsGrantFailed,
    capabilities: AdministratorRoster.Live,
    publicFailure: (cause, locale) =>
      Predicate.isTagged(cause, "AdministratorAccountNotFoundError")
        ? m.administratorsGrantAccountNotFound({}, { locale })
        : undefined,
    revalidates: administratorsPath,
  },
  Effect.fn(function* (input) {
    const actor = yield* CurrentAdministrator;
    const roster = yield* AdministratorRoster;
    return yield* roster.grant({ email: input.email, actor });
  })
);

export const grantAdministrator: typeof grantAdministratorAction = async (
  ...args: Parameters<typeof grantAdministratorAction>
) => {
  "use server";
  return await grantAdministratorAction(...args);
};

const revokeAdministratorAction = defineAdministrationAction(
  {
    operation: "administrators.revoke",
    schema: revokeAdministratorStandardSchema,
    failureCopy,
    fallback: m.administratorsRevokeFailed,
    capabilities: AdministratorRoster.Live,
    publicFailure: (cause, locale) =>
      Predicate.isTagged(cause, "AdministratorSelfRevocationError")
        ? m.administratorsRevokeSelf({}, { locale })
        : undefined,
    revalidates: administratorsPath,
  },
  Effect.fn(function* (input) {
    const actor = yield* CurrentAdministrator;
    const roster = yield* AdministratorRoster;
    return yield* roster.revoke({ accountId: input.accountId, actor });
  })
);

export const revokeAdministrator: typeof revokeAdministratorAction = async (
  ...args: Parameters<typeof revokeAdministratorAction>
) => {
  "use server";
  return await revokeAdministratorAction(...args);
};
