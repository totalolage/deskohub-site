import "server-only";

import {
  CliAuthenticationCode,
  type CliAuthenticationCodeType,
} from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type {
  CliApprovalRequest,
  CliSessionAdministrationItem,
} from "./cli-authentication.service";
import { CliAuthentication } from "./cli-authentication.service";

type CliAuthenticationCodeInput = FormDataEntryValue | null | undefined;

export type CliApprovalPageData = {
  /** The signed-in administrator's login email. */
  readonly administratorEmail: string;
  readonly request: CliApprovalRequest | null;
};

export type CliSessionsPageData = {
  /** The signed-in administrator's login email. */
  readonly administratorEmail: string;
  readonly sessions: ReadonlyArray<CliSessionAdministrationItem>;
};

export const loadCliAuthenticationApproval = async (
  code: CliAuthenticationCodeInput
): Promise<CliApprovalPageData | null> => {
  const administrator = await authorizeAdministratorPage();
  const decoded = Schema.decodeUnknownOption(CliAuthenticationCode)(code);
  if (Option.isNone(decoded)) return null;

  return {
    administratorEmail: administrator.email,
    request: await CliAuthentication.pipe(
      Effect.flatMap((authentication) =>
        authentication.inspectApproval(decoded.value)
      ),
      Effect.provide(CliAuthentication.Live),
      runWorkspaceEffect("cli-authentication.inspect-approval", {
        boundary: "page",
      })
    ),
  };
};

export const loadCliSessions = async (): Promise<CliSessionsPageData> => {
  const administrator = await authorizeAdministratorPage();
  return {
    administratorEmail: administrator.email,
    sessions: await CliAuthentication.pipe(
      Effect.flatMap((authentication) =>
        authentication.listSessions(administrator.accountId)
      ),
      Effect.provide(CliAuthentication.Live),
      runWorkspaceEffect("cli-authentication.list-sessions", {
        boundary: "page",
      })
    ),
  };
};

export const decodeCliAuthenticationCode = (code: CliAuthenticationCodeInput) =>
  Schema.decodeUnknownEffect(CliAuthenticationCode)(code) as Effect.Effect<
    CliAuthenticationCodeType,
    Schema.SchemaError
  >;
