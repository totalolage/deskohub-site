"use server";

import { CliSessionId } from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CliAuthentication } from "./cli-authentication.service";
import { decodeCliAuthenticationCode } from "./page-data.server";

export async function approveCliAuthentication(formData: FormData) {
  const rawCode = formData.get("code");
  const codeForRedirect = typeof rawCode === "string" ? rawCode : "";

  const approved = await Effect.gen(function* () {
    yield* requireDiscountAdminAuthorization();
    const code = yield* decodeCliAuthenticationCode(rawCode);
    const authentication = yield* CliAuthentication;
    return yield* authentication.approve(code);
  }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
    Effect.provide(CliAuthentication.LiveWithDependencies),
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
    yield* requireDiscountAdminAuthorization();
    const sessionId = yield* Schema.decodeUnknownEffect(CliSessionId)(
      formData.get("sessionId")
    );
    const authentication = yield* CliAuthentication;
    return yield* authentication.revoke(sessionId);
  }).pipe(
    Effect.catch(() => Effect.succeed(false)),
    Effect.provide(CliAuthentication.LiveWithDependencies),
    runWorkspaceEffect("cli-authentication.revoke", { boundary: "action" })
  );

  revalidatePath("/admin/cli/sessions");
  const search = new URLSearchParams({
    result: revoked ? "revoked" : "unchanged",
  });
  redirect(`/admin/cli/sessions?${search}`);
}
