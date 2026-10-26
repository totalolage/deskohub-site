import "server-only";

import { Effect } from "effect";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import {
  type InvoiceAdministrationListQuery,
  InvoiceAdministrationService,
} from "./invoice-administration.service";

export type InvoiceAdministrationSearchParams = Promise<{
  readonly sort?: string;
  readonly direction?: string;
  readonly page?: string;
}>;

const invoiceNotFound = () => Effect.fail(new AdministrationRecordNotFound());

export const loadInvoiceAdministrationList = (
  searchParams: InvoiceAdministrationSearchParams
) =>
  runAdministrationPage(
    "invoice-administration.list",
    Effect.gen(function* () {
      const params = yield* Effect.promise(() => searchParams);
      const query: InvoiceAdministrationListQuery = {
        ...(isSort(params.sort) && { sort: params.sort }),
        ...(isDirection(params.direction) && { direction: params.direction }),
        ...(isPage(params.page) && { page: Number(params.page) }),
      };
      const administration = yield* InvoiceAdministrationService;
      return { items: yield* administration.list(query), query };
    }),
    InvoiceAdministrationService.Live
  );

export const loadInvoiceCreationPage = () =>
  runAdministrationPage(
    "invoice-administration.creation-defaults",
    Effect.gen(function* () {
      const administration = yield* InvoiceAdministrationService;
      return yield* administration.getCreationDefaults();
    }),
    InvoiceAdministrationService.Live
  );

export const loadInvoiceAdministrationDetail = (invoiceId: string) =>
  runAdministrationPage(
    "invoice-administration.get",
    Effect.gen(function* () {
      const administration = yield* InvoiceAdministrationService;
      return yield* administration.get(invoiceId);
    }).pipe(
      Effect.catchTag("InvoiceAdministrationNotFoundError", invoiceNotFound)
    ),
    InvoiceAdministrationService.Live
  );

export const loadInvoiceAdministrationPdf = (invoiceId: string) =>
  runAdministrationPage(
    "invoice-administration.pdf",
    Effect.gen(function* () {
      const administration = yield* InvoiceAdministrationService;
      return yield* administration.getPdf(invoiceId);
    }).pipe(
      Effect.catchTag("InvoiceAdministrationNotFoundError", invoiceNotFound)
    ),
    InvoiceAdministrationService.Live
  );

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
