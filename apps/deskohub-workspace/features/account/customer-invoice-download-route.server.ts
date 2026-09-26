import "server-only";

import { Effect, type Layer, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import { CustomerInvoiceService } from "@/features/account/backend/customer-invoice.service";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { isLocale } from "@/features/i18n";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

type CustomerInvoicePdfRouteContext = {
  readonly params: Promise<{ invoiceId: string }>;
};

type CustomerInvoiceCsvRouteContext = {
  readonly params: Promise<{ locale: string }>;
};

/**
 * Every customer invoice download answer is private: not-found responses and
 * documents share the same no-store cache contract, and expected failures map
 * here at the route boundary so domain services stay free of HTTP statuses.
 */
const privateAttachmentResponse = (input: {
  readonly body: BodyInit;
  readonly contentType: string;
  readonly fileName: string;
}) => {
  const response = new NextResponse(input.body, {
    headers: {
      "Content-Disposition": `attachment; filename="${input.fileName}"`,
      "Content-Type": input.contentType,
      "Cache-Control": "private, no-store",
    },
  });
  return response;
};

const privateNotFoundResponse = () => {
  const response = new NextResponse(null, { status: 404 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

/**
 * Unexpected route failures answer with the same private no-store cache
 * contract as every other answer from these routes; the recovery is local so
 * the shared default for other workspace routes stays untouched.
 */
const privateFailureResponse = (failure: WorkspaceRouteFailure) => {
  const response = NextResponse.json(
    { error: failure.publicMessage },
    { status: failure.statusCode }
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

const decodeRouteInvoiceId = Schema.decodeUnknownOption(invoiceIdSchema);

const toRouteFailure = (publicMessage: string) => (cause: unknown) =>
  WorkspaceRouteFailure.internal(publicMessage)(cause);

export const makeCustomerInvoicePdfGet = (
  serviceLayer: Layer.Layer<
    CustomerInvoiceService,
    Schema.SchemaError
  > = CustomerInvoiceService.Live
) =>
  defineWorkspaceRoute(
    {
      operation: "account.invoice-pdf",
      cancellation: "interrupt-on-disconnect",
    },
    (_request, context: CustomerInvoicePdfRouteContext) =>
      Effect.flatMap(
        Effect.promise(() => context.params),
        ({ invoiceId }) => {
          // A malformed invoice id can never match a stored row; it takes the
          // same indistinguishable not-found response as a missing or
          // non-owned invoice without touching the database.
          if (Option.isNone(decodeRouteInvoiceId(invoiceId))) {
            return Effect.succeed(privateNotFoundResponse());
          }
          return Effect.gen(function* () {
            const invoices = yield* CustomerInvoiceService;
            const pdf = yield* invoices.findPdf(invoiceId);
            return privateAttachmentResponse({
              body: Uint8Array.from(pdf.bytes),
              contentType: "application/pdf",
              fileName: pdf.fileName,
            });
          }).pipe(
            Effect.provide(serviceLayer),
            Effect.catchTag(
              [
                "CustomerInvoiceNotFoundError",
                "CustomerInvoicesUnavailableError",
              ],
              () => Effect.succeed(privateNotFoundResponse())
            ),
            Effect.catch((cause) =>
              Effect.succeed(
                privateFailureResponse(
                  toRouteFailure("Customer invoice could not be loaded")(cause)
                )
              )
            )
          );
        }
      )
  );

export const makeCustomerInvoiceCsvGet = (
  serviceLayer: Layer.Layer<
    CustomerInvoiceService,
    Schema.SchemaError
  > = CustomerInvoiceService.Live
) =>
  defineWorkspaceRoute(
    {
      operation: "account.invoice-csv",
      cancellation: "interrupt-on-disconnect",
    },
    (_request, context: CustomerInvoiceCsvRouteContext) =>
      Effect.flatMap(
        Effect.promise(() => context.params),
        ({ locale }) => {
          if (!isLocale(locale)) {
            return Effect.succeed(privateNotFoundResponse());
          }
          return Effect.gen(function* () {
            const invoices = yield* CustomerInvoiceService;
            const csv = yield* invoices.buildCsv(locale);
            return privateAttachmentResponse({
              body: csv.content,
              contentType: "text/csv; charset=utf-8",
              fileName: csv.fileName,
            });
          }).pipe(
            Effect.provide(serviceLayer),
            Effect.catchTag("CustomerInvoicesUnavailableError", () =>
              Effect.succeed(privateNotFoundResponse())
            ),
            Effect.catch((cause) =>
              Effect.succeed(
                privateFailureResponse(
                  toRouteFailure("Customer invoices could not be exported")(
                    cause
                  )
                )
              )
            )
          );
        }
      )
  );
