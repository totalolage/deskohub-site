import "server-only";

import { Effect } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  administrationFixturesEnabled,
  loadFixtureCustomerCodeCreation,
} from "@/features/administration/fixtures";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { DiscountCodeId } from "../persistence-contracts";
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
  await authorizeDiscountAdminPage();

  const dashboard = await Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadDashboard();
  }).pipe(
    Effect.provide(DiscountAdministrationLive),
    runWorkspaceEffect("discount-administration.load", {
      boundary: "route",
    })
  );
  const notice = await loadNotice(searchParams);

  return { dashboard, notice };
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

  const detail = await Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadCodeDetail({ codeId });
  }).pipe(
    Effect.catchTag("DiscountAdminNotFoundError", () => Effect.succeed(null)),
    Effect.provide(DiscountAdministrationLive),
    runWorkspaceEffect("discount-administration.load-code", {
      boundary: "route",
    })
  );
  if (!detail) notFound();

  return {
    detail,
    notice: await loadNotice(searchParams),
  };
};

export const loadDiscountAdminCustomerPageData = async (
  customerId: DotyposCustomerId,
  searchParams: DiscountAdminSearchParams
) => {
  await authorizeDiscountAdminPage();

  const profile = await Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadCustomerProfile({ customerId });
  }).pipe(
    Effect.catchTag("DiscountAdminNotFoundError", () => Effect.succeed(null)),
    Effect.provide(DiscountAdministrationLive),
    runWorkspaceEffect("discount-administration.load-customer", {
      boundary: "route",
    })
  );
  if (!profile) notFound();

  return {
    profile,
    notice: await loadNotice(searchParams),
  };
};

export const loadDiscountAdminCustomerCodeCreationPageData = async (
  customerId: DotyposCustomerId
) => {
  if (administrationFixturesEnabled()) {
    const fixture = loadFixtureCustomerCodeCreation(customerId);
    if (!fixture) notFound();
    return fixture;
  }

  await authorizeDiscountAdminPage();

  const data = await Effect.gen(function* () {
    const administration = yield* DiscountAdministration;
    return yield* administration.loadCustomerCodeCreation({ customerId });
  }).pipe(
    Effect.catchTag("DiscountAdminNotFoundError", () => Effect.succeed(null)),
    Effect.provide(DiscountAdministrationLive),
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
      Effect.provide(DiscountAdministrationLive),
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
  const profile = await loadOptionalDiscountAdminCustomerProfile(customerId);

  return {
    profile,
    notice: await loadNotice(searchParams),
  };
};

export const loadDiscountAdminCustomerBreadcrumbLabel = async (
  customerId: DotyposCustomerId
) => {
  await authorizeDiscountAdminPage();
  const profile = await loadOptionalDiscountAdminCustomerProfile(customerId);
  return profile?.customer.displayName;
};

export const authorizeDiscountAdminPage = async () => {
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
};

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
