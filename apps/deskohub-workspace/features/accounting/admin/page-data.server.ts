import "server-only";

import { Effect } from "effect";
import { notFound } from "next/navigation";
import { authorizeAdministratorPage } from "@/shared/administrator/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type InvoiceAdministrationListQuery,
  InvoiceAdministrationService,
} from "./invoice-administration.service";

export type InvoiceAdministrationSearchParams = Promise<{
  readonly sort?: string;
  readonly direction?: string;
  readonly page?: string;
}>;

export const loadInvoiceAdministrationList = async (
  searchParams: InvoiceAdministrationSearchParams
) => {
  await authorizeAdministratorPage();
  const params = await searchParams;
  const query: InvoiceAdministrationListQuery = {
    ...(isSort(params.sort) && { sort: params.sort }),
    ...(isDirection(params.direction) && { direction: params.direction }),
    ...(isPage(params.page) && { page: Number(params.page) }),
  };
  const items = await Effect.gen(function* () {
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.list(query);
  }).pipe(
    Effect.provide(InvoiceAdministrationService.Live),
    runWorkspaceEffect("invoice-administration.list", { boundary: "route" })
  );
  return { items, query };
};

export const loadInvoiceCreationPage = async () => {
  await authorizeAdministratorPage();
  return Effect.gen(function* () {
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.getCreationDefaults();
  }).pipe(
    Effect.provide(InvoiceAdministrationService.Live),
    runWorkspaceEffect("invoice-administration.creation-defaults", {
      boundary: "route",
    })
  );
};

export const loadInvoiceAdministrationDetail = async (invoiceId: string) => {
  await authorizeAdministratorPage();
  const detail = await Effect.gen(function* () {
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.get(invoiceId);
  }).pipe(
    Effect.catchTag("InvoiceAdministrationNotFoundError", () =>
      Effect.succeed(null)
    ),
    Effect.provide(InvoiceAdministrationService.Live),
    runWorkspaceEffect("invoice-administration.get", { boundary: "route" })
  );
  if (!detail) notFound();
  return detail;
};

export const loadInvoiceAdministrationPdf = async (invoiceId: string) => {
  await authorizeAdministratorPage();
  const pdf = await Effect.gen(function* () {
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.getPdf(invoiceId);
  }).pipe(
    Effect.catchTag("InvoiceAdministrationNotFoundError", () =>
      Effect.succeed(null)
    ),
    Effect.provide(InvoiceAdministrationService.Live),
    runWorkspaceEffect("invoice-administration.pdf", { boundary: "route" })
  );
  if (!pdf) notFound();
  return pdf;
};

const isSort = (
  value: string | undefined
): value is NonNullable<InvoiceAdministrationListQuery["sort"]> =>
  value === "invoiceNumber" ||
  value === "issuedAt" ||
  value === "customer" ||
  value === "total" ||
  value === "paymentStatus" ||
  value === "source" ||
  value === "delivery";

const isDirection = (value: string | undefined): value is "asc" | "desc" =>
  value === "asc" || value === "desc";
const isPage = (value: string | undefined) =>
  Boolean(value && /^\d+$/.test(value) && Number(value) >= 1);
