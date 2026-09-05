import "server-only";

import {
  type AdministrationActorUsernameType,
  CliAuthenticationCode,
  type CliAuthenticationCodeType,
} from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { authorizeAdministratorPage } from "@/shared/administrator/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type {
  CliApprovalRequest,
  CliSessionAdministrationItem,
} from "./cli-authentication.service";
import { CliAuthentication } from "./cli-authentication.service";

type CliAuthenticationCodeInput = FormDataEntryValue | null | undefined;

export type CliApprovalPageData = {
  readonly username: AdministrationActorUsernameType;
  readonly request: CliApprovalRequest | null;
};

export type CliSessionsPageData = {
  readonly username: AdministrationActorUsernameType;
  readonly sessions: ReadonlyArray<CliSessionAdministrationItem>;
};

export const loadCliAuthenticationApproval = async (
  code: CliAuthenticationCodeInput
): Promise<CliApprovalPageData | null> => {
  const username = await authorizeAdministratorPage();
  const decoded = Schema.decodeUnknownOption(CliAuthenticationCode)(code);
  if (Option.isNone(decoded)) return null;

  return {
    username,
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
  const username = await authorizeAdministratorPage();
  return {
    username,
    sessions: await CliAuthentication.pipe(
      Effect.flatMap((authentication) => authentication.listSessions(username)),
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
