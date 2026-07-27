import "server-only";

import { Effect } from "effect";
import { notFound } from "next/navigation";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { requireDiscountAdminAuthorization } from "./basic-auth.server";
import { DiscountAdministrationLive } from "./discount-administration.runtime";
import { DiscountAdministration } from "./discount-administration.service";

export type DiscountAdminSearchParams = Promise<{
  readonly notice?: string;
  readonly status?: string;
}>;

export const loadDiscountAdminPageData = async (
  searchParams: DiscountAdminSearchParams
) => {
  const authorized = await requireDiscountAdminAuthorization().pipe(
    Effect.as(true),
    Effect.catchTag("DiscountAdminUnauthorizedError", () =>
      Effect.succeed(false)
    ),
    runWorkspaceEffect("discount-administration.authorize", {
      boundary: "route",
    })
  );

  if (!authorized) {
    notFound();
  }

  const dashboard = await Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadDashboard();
  }).pipe(
    Effect.provide(DiscountAdministrationLive),
    runWorkspaceEffect("discount-administration.load", {
      boundary: "route",
    })
  );
  const params = await searchParams;
  const status = params.status;
  const notice =
    params.notice && (status === "success" || status === "error")
      ? {
          message: params.notice,
          status: status as "error" | "success",
        }
      : undefined;

  return { dashboard, notice };
};
