import "server-only";

import { connection } from "next/server";
import { cache } from "react";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

export const authorizeInvoiceAdministrationPage = cache(async () => {
  await connection();
  await requireDiscountAdminAuthorization().pipe(
    runWorkspaceEffect("invoice-administration.authorize", {
      boundary: "route",
    })
  );
});
