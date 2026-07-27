/**
 * THESIS: A working operator ledger, not a dashboard of abstract metrics.
 * OWN-WORLD: Deskohub navy, paper-white work areas, and orange task controls.
 * STORY: Edit database definitions and codes, then verify Calendar references.
 * FIRST VIEWPORT: Compact identity header, anchored navigation, and direct creation controls.
 * FORM: One continuous three-part operations sheet in the incumbent Workspace system.
 */
import { Effect } from "effect";
import { notFound } from "next/navigation";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { DiscountAdministrationPage } from "@/features/discounts/admin/components";
import { DiscountAdministrationLive } from "@/features/discounts/admin/discount-administration.runtime";
import { DiscountAdministration } from "@/features/discounts/admin/discount-administration.service";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

export const dynamic = "force-dynamic";

type DiscountAdminPageProps = {
  readonly searchParams: Promise<{
    readonly notice?: string;
    readonly status?: string;
  }>;
};

export default async function DiscountAdminPage({
  searchParams,
}: DiscountAdminPageProps) {
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
  const notice:
    | {
        readonly message: string;
        readonly status: "error" | "success";
      }
    | undefined =
    params.notice && (status === "success" || status === "error")
      ? {
          message: params.notice,
          status: status as "error" | "success",
        }
      : undefined;

  return <DiscountAdministrationPage dashboard={dashboard} notice={notice} />;
}
