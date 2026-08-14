import "server-only";

import { Effect } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { DiscountCodeId, VoucherId } from "../persistence-contracts";
import { requireDiscountAdminAuthorization } from "./basic-auth.server";
import { DiscountAdministration } from "./discount-administration.service";

export type DiscountAdminSearchParams = Promise<{
  readonly notice?: string;
  readonly status?: string;
}>;

export const loadDiscountAdminPageData = async (
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();

  const dashboard = Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadDashboard();
  }).pipe(
    Effect.provide(DiscountAdministration.Live),
    runWorkspaceEffect("discount-administration.load", {
      boundary: "route",
    })
  );
  const [resolvedDashboard, notice] = await Promise.all([
    dashboard,
    loadNotice(searchParams),
  ]);

  return { dashboard: resolvedDashboard, notice };
};

export const loadDiscountAdminCodesPageData = async (
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();
  const dashboard = Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadCodesPage();
  }).pipe(
    Effect.provide(DiscountAdministration.Live),
    runWorkspaceEffect("discount-administration.load-codes", {
      boundary: "route",
    })
  );
  const [resolvedDashboard, notice] = await Promise.all([
    dashboard,
    loadNotice(searchParams),
  ]);
  return { dashboard: resolvedDashboard, notice };
};

export const loadDiscountAdminSalesPageData = async (
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();
  const dashboard = Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadSalesPage();
  }).pipe(
    Effect.provide(DiscountAdministration.Live),
    runWorkspaceEffect("discount-administration.load-sales", {
      boundary: "route",
    })
  );
  const [resolvedDashboard, notice] = await Promise.all([
    dashboard,
    loadNotice(searchParams),
  ]);
  return { dashboard: resolvedDashboard, notice };
};

export const loadDiscountAdminVouchersPageData = async (
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();
  const dashboard = Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadVouchersPage();
  }).pipe(
    Effect.provide(DiscountAdministration.Live),
    runWorkspaceEffect("discount-administration.load-vouchers", {
      boundary: "route",
    })
  );
  const [resolvedDashboard, notice] = await Promise.all([
    dashboard,
    loadNotice(searchParams),
  ]);
  return { dashboard: resolvedDashboard, notice };
};

export const loadDiscountAdminShellPageData = async (
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();
  return { notice: await loadNotice(searchParams) };
};

export const loadDiscountAdminCodePageData = async (
  codeId: DiscountCodeId,
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();

  const detail = Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadCodeDetail({ codeId });
  }).pipe(
    Effect.catchTag("DiscountAdminNotFoundError", () => Effect.succeed(null)),
    Effect.provide(DiscountAdministration.Live),
    runWorkspaceEffect("discount-administration.load-code", {
      boundary: "route",
    })
  );
  const [resolvedDetail, notice] = await Promise.all([
    detail,
    loadNotice(searchParams),
  ]);
  if (!resolvedDetail) notFound();

  return {
    detail: resolvedDetail,
    notice,
  };
};

export const loadDiscountAdminCustomerPageData = async (
  customerId: DotyposCustomerId,
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();

  const profile = Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadCustomerProfile({ customerId });
  }).pipe(
    Effect.catchTag("DiscountAdminNotFoundError", () => Effect.succeed(null)),
    Effect.provide(DiscountAdministration.Live),
    runWorkspaceEffect("discount-administration.load-customer", {
      boundary: "route",
    })
  );
  const [resolvedProfile, notice] = await Promise.all([
    profile,
    loadNotice(searchParams),
  ]);
  if (!resolvedProfile) notFound();

  return {
    profile: resolvedProfile,
    notice,
  };
};

export const loadDiscountAdminVoucherPageData = async (
  voucherId: VoucherId,
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();
  const detail = Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadVoucherDetail({ voucherId });
  }).pipe(
    Effect.catchTag("DiscountAdminNotFoundError", () => Effect.succeed(null)),
    Effect.provide(DiscountAdministration.Live),
    runWorkspaceEffect("discount-administration.load-voucher", {
      boundary: "route",
    })
  );
  const [resolvedDetail, notice] = await Promise.all([
    detail,
    loadNotice(searchParams),
  ]);
  if (!resolvedDetail) notFound();
  return { detail: resolvedDetail, notice };
};

export const loadDiscountAdminCustomerCodeCreationPageData = async (
  customerId: DotyposCustomerId
) => {
  await authorizeDiscountAdminPage();

  const data = await Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadCustomerCodeCreation({ customerId });
  }).pipe(
    Effect.catchTag("DiscountAdminNotFoundError", () => Effect.succeed(null)),
    Effect.provide(DiscountAdministration.Live),
    runWorkspaceEffect("discount-administration.load-customer-code-creation", {
      boundary: "route",
    })
  );
  if (!data) notFound();
  return data;
};

const loadOptionalDiscountAdminCustomerProfile = cache(
  async (customerId: DotyposCustomerId) =>
    Effect.gen(function* () {
      const administration = yield* DiscountAdministration;
      return yield* administration.loadCustomerProfile({ customerId });
    }).pipe(
      Effect.catchTag("DiscountAdminNotFoundError", () => Effect.succeed(null)),
      Effect.catch((cause) =>
        Effect.logWarning("Customer administration details unavailable", {
          cause,
          customerId,
        }).pipe(Effect.as(null))
      ),
      Effect.provide(DiscountAdministration.Live),
      runWorkspaceEffect("discount-administration.load-customer-optional", {
        boundary: "route",
      })
    )
);

export const loadOptionalDiscountAdminCustomerPageData = async (
  customerId: DotyposCustomerId,
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();
  const [profile, notice] = await Promise.all([
    loadOptionalDiscountAdminCustomerProfile(customerId),
    loadNotice(searchParams),
  ]);

  return {
    profile,
    notice,
  };
};

export const loadDiscountAdminCustomerBreadcrumbLabel = async (
  customerId: DotyposCustomerId
) => {
  await authorizeDiscountAdminPage();
  return Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadCustomerBreadcrumbLabel({ customerId });
  }).pipe(
    Effect.provide(DiscountAdministration.Live),
    Effect.catch((cause) =>
      Effect.logWarning("Customer breadcrumb label unavailable", {
        cause,
        customerId,
      }).pipe(Effect.as(undefined))
    ),
    runWorkspaceEffect("discount-administration.customer-breadcrumb", {
      boundary: "route",
    })
  );
};

export const authorizeDiscountAdminPage = cache(async () => {
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
});

const loadNotice = async (searchParams: DiscountAdminSearchParams) => {
  const params = await searchParams;
  const status = params.status;
  const notice =
    params.notice && (status === "success" || status === "error")
      ? {
          message: params.notice,
          status: status as "error" | "success",
        }
      : undefined;

  return notice;
};
