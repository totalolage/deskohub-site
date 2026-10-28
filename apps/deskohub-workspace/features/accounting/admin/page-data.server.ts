import "server-only";

import { Effect } from "effect";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import type { SearchParamsRecord } from "@/shared/utils/search-params";
import { InvoiceAdministrationService } from "./invoice-administration.service";
import { invoiceListQuery } from "./invoice-list-query";

export type InvoiceAdministrationSearchParams = Promise<SearchParamsRecord>;

const invoiceNotFound = () => Effect.fail(new AdministrationRecordNotFound());

export const loadInvoiceAdministrationList = (
  searchParams: InvoiceAdministrationSearchParams
) =>
  runAdministrationPage(
    "invoice-administration.list",
    Effect.gen(function* () {
      const query = invoiceListQuery.parse(
        yield* Effect.promise(() => searchParams)
      );
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
