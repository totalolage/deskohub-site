import "server-only";

import { CliAuthenticationCode } from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { runAdministrationPage } from "@/features/administrators/server/administration-request.server";
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

export const loadCliAuthenticationApproval = (
  code: CliAuthenticationCodeInput
): Promise<CliApprovalPageData | null> =>
  runAdministrationPage(
    "cli-authentication.inspect-approval",
    Effect.gen(function* () {
      const administrator = yield* CurrentAdministrator;
      const decoded = Schema.decodeUnknownOption(CliAuthenticationCode)(code);
      if (Option.isNone(decoded)) return null;
      const authentication = yield* CliAuthentication;
      return {
        administratorEmail: administrator.email,
        request: yield* authentication.inspectApproval(decoded.value),
      };
    }),
    CliAuthentication.Live
  );

export const loadCliSessions = (): Promise<CliSessionsPageData> =>
  runAdministrationPage(
    "cli-authentication.list-sessions",
    Effect.gen(function* () {
      const administrator = yield* CurrentAdministrator;
      const authentication = yield* CliAuthentication;
      return {
        administratorEmail: administrator.email,
        sessions: yield* authentication.listSessions(administrator.accountId),
      };
    }),
    CliAuthentication.Live
  );
