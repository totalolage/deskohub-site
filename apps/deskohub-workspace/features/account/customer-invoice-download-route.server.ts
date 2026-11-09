import "server-only";

import { Data, Effect, Layer } from "effect";
import { isLocale, type Locale } from "@/features/i18n";
import { catchRecoverableCause } from "@/shared/backend/workspace-effect";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";
import { createCsvDownloadResponse } from "@/shared/utils/csv";
import { createDownloadResponse } from "@/shared/utils/download-response";
import { markPrivateResponse } from "@/shared/utils/private-response";
import { CustomerInvoiceService } from "./backend/customer-invoice.service";

/** The service the routes read, live unless a test provides a fake. */
type CustomerInvoiceServiceLayer = Layer.Layer<CustomerInvoiceService, unknown>;

type CustomerInvoicePdfParams = {
  readonly params: Promise<{
    readonly locale: string;
    readonly invoiceId: string;
  }>;
};

type CustomerInvoiceExportParams = {
  readonly params: Promise<{ readonly locale: string }>;
};

/**
 * `GET /[locale]/account/invoices/[invoiceId]/pdf`: one of the signed-in
 * customer's invoices as a PDF attachment.
 */
export const makeCustomerInvoicePdfGet = (
  service: CustomerInvoiceServiceLayer = CustomerInvoiceService.Live
) =>
  defineWorkspaceRoute(
    {
      operation: "account.invoice-pdf",
      cancellation: "interrupt-on-disconnect",
      caller: "client",
    },
    (_request: Request, { params }: CustomerInvoicePdfParams) =>
      routeLocale(params).pipe(
        Effect.flatMap(({ invoiceId }) =>
          Effect.flatMap(CustomerInvoiceService, (invoices) =>
            invoices.pdf(invoiceId)
          ).pipe(withService(service))
        ),
        Effect.map(({ bytes, fileName }) =>
          createDownloadResponse({
            body: Uint8Array.from(bytes),
            contentType: "application/pdf",
            filename: fileName,
          })
        ),
        Effect.catchTags({
          CustomerInvoiceRouteNotFound: answerNotFound,
          CustomerInvoiceNotFoundError: answerNotFound,
          CustomerInvoicesUnavailableError: answerNotFound,
          CustomerInvoicesLoadError: answerLoadFailed,
        }),
        answerUnexpected
      )
  );

/**
 * `GET /[locale]/account/invoices/export`: the signed-in customer's invoices
 * as a CSV attachment with headers in the route locale.
 */
export const makeCustomerInvoiceExportGet = (
  service: CustomerInvoiceServiceLayer = CustomerInvoiceService.Live
) =>
  defineWorkspaceRoute(
    {
      operation: "account.invoice-export",
      cancellation: "interrupt-on-disconnect",
      caller: "client",
    },
    (_request: Request, { params }: CustomerInvoiceExportParams) =>
      routeLocale(params).pipe(
        Effect.flatMap(({ locale }) =>
          Effect.flatMap(CustomerInvoiceService, (invoices) =>
            invoices.csv(locale)
          ).pipe(withService(service))
        ),
        Effect.map(createCsvDownloadResponse),
        Effect.catchTags({
          CustomerInvoiceRouteNotFound: answerNotFound,
          CustomerInvoicesUnavailableError: answerNotFound,
          CustomerInvoicesLoadError: answerLoadFailed,
        }),
        answerUnexpected
      )
  );

/** The route's own parameters can't name a customer's invoices. */
class CustomerInvoiceRouteNotFound extends Data.TaggedError(
  "CustomerInvoiceRouteNotFound"
) {}

/**
 * Provides the service only once the route's own parameters passed, so an
 * invalid locale is refused even when the service can't be built. A build
 * failure becomes a defect, which `answerUnexpected` answers.
 */
const withService =
  (service: CustomerInvoiceServiceLayer) =>
  <A, E>(self: Effect.Effect<A, E, CustomerInvoiceService>) =>
    self.pipe(Effect.provide(Layer.orDie(service)));

const routeLocale = <Params extends { readonly locale: string }>(
  params: Promise<Params>
) =>
  Effect.promise(() => params).pipe(
    Effect.filterOrFail(
      (values): values is Params & { readonly locale: Locale } =>
        isLocale(values.locale),
      () => new CustomerInvoiceRouteNotFound()
    )
  );

/*
 * Every refusal (signed out, no linked customer, a review account, deletion
 * pending, another customer's or an unknown invoice, an invalid locale)
 * answers the same private 404, so a response never tells whether an
 * invoice exists. A load failure answers a private 500 without any document
 * bytes; the service already logged its fixed code. Anything else, such as a
 * service that couldn't be built, logs only this route's code.
 */
const answerNotFound = () => Effect.sync(notFoundResponse);

const answerLoadFailed = () => Effect.sync(loadFailedResponse);

const answerUnexpected = catchRecoverableCause(() =>
  Effect.logError("Customer invoice download failed", {
    failureCode: "account.invoice-download",
  }).pipe(Effect.andThen(Effect.sync(loadFailedResponse)))
);

const notFoundResponse = () =>
  markPrivateResponse(new Response(null, { status: 404 }));

const loadFailedResponse = () =>
  markPrivateResponse(
    Response.json(
      { error: "Customer invoices could not be loaded." },
      { status: 500 }
    )
  );
