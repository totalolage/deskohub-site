import "server-only";

import {
  CliAuthenticationCode,
  type CliAuthenticationCodeType,
} from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { authorizeDiscountAdminPage } from "@/features/discounts/admin/page-data.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CliAuthentication } from "./cli-authentication.service";

type CliAuthenticationCodeInput = FormDataEntryValue | null | undefined;

export const loadCliAuthenticationApproval = async (
  code: CliAuthenticationCodeInput
) => {
  await authorizeDiscountAdminPage();
  const decoded = Schema.decodeUnknownOption(CliAuthenticationCode)(code);
  if (Option.isNone(decoded)) return null;

  return CliAuthentication.pipe(
    Effect.flatMap((authentication) =>
      authentication.inspectApproval(decoded.value)
    ),
    Effect.provide(CliAuthentication.LiveWithDependencies),
    runWorkspaceEffect("cli-authentication.inspect-approval", {
      boundary: "page",
    })
  );
};

export const loadCliSessions = async () => {
  await authorizeDiscountAdminPage();
  return CliAuthentication.pipe(
    Effect.flatMap((authentication) => authentication.listSessions()),
    Effect.provide(CliAuthentication.LiveWithDependencies),
    runWorkspaceEffect("cli-authentication.list-sessions", {
      boundary: "page",
    })
  );
};

export const decodeCliAuthenticationCode = (code: CliAuthenticationCodeInput) =>
  Schema.decodeUnknownEffect(CliAuthenticationCode)(code) as Effect.Effect<
    CliAuthenticationCodeType,
    Schema.SchemaError
  >;
