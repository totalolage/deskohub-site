"use server";

import {
  AdministrationCustomerSearchQuery,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { Effect, Match, Schema } from "effect";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { InvoiceAdministrationService } from "./invoice-administration.service";

const strict = { errors: "all", onExcessProperty: "error" } as const;

const createInvoiceAction = defineWorkspaceAction(
  {
    operation: "invoice-administration.create",
    schema: Schema.toStandardSchemaV1(AdministrationInvoiceCreateInput, {
      parseOptions: strict,
    }),
    logInput: false,
  },
  Effect.fn(
    function* (input) {
      const actor = yield* requireAdministratorAuthorization;
      const administration = yield* InvoiceAdministrationService;
      const result = yield* administration.create(input, {
        source: "admin-ui",
        actor,
      });
      yield* Effect.sync(() => {
        revalidateLocalizedPath("/admin/invoices");
        revalidateLocalizedPath(`/admin/invoices/${result.invoiceId}`);
      });
      return result;
    },
    (effect) =>
      effect.pipe(
        Effect.provide(InvoiceAdministrationService.Live),
        Effect.mapError(
          (cause) =>
            new PublicSafeActionError({
              message: Match.value(cause).pipe(
                Match.tag(
                  "InvoiceAdministrationCustomerError",
                  "InvoiceAdministrationInProgressError",
                  ({ message }) => message
                ),
                Match.orElse(
                  () =>
                    "The invoice could not be created. Check the customer and invoice details, then try again."
                )
              ),
              cause,
            })
        )
      )
  )
);

const previewInvoiceAction = defineWorkspaceAction(
  {
    operation: "invoice-administration.preview",
    schema: Schema.toStandardSchemaV1(AdministrationInvoiceCreateInput, {
      parseOptions: strict,
    }),
    logInput: false,
  },
  Effect.fn(
    function* (input) {
      const actor = yield* requireAdministratorAuthorization;
      const administration = yield* InvoiceAdministrationService;
      const pdf = yield* administration.preview(input, {
        source: "admin-ui",
        actor,
      });
      return {
        dataUrl: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
      };
    },
    (effect) =>
      effect.pipe(
        Effect.provide(InvoiceAdministrationService.Live),
        Effect.mapError(
          (cause) =>
            new PublicSafeActionError({
              message: "The invoice preview could not be generated.",
              cause,
            })
        )
      )
  )
);

const searchCustomersAction = defineWorkspaceAction(
  {
    operation: "invoice-administration.search-customers",
    schema: Schema.toStandardSchemaV1(AdministrationCustomerSearchQuery, {
      parseOptions: strict,
    }),
    logInput: false,
  },
  (input) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const administration = yield* InvoiceAdministrationService;
          return yield* administration.searchCustomers(input.query);
        })
      ),
      Effect.provide(InvoiceAdministrationService.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "Customer search is temporarily unavailable.",
            cause,
          })
      )
    )
);

const retryInvoiceAction = defineWorkspaceAction(
  {
    operation: "invoice-administration.retry-delivery",
    schema: Schema.toStandardSchemaV1(
      Schema.Struct({ invoiceId: AdministrationInvoiceId }),
      { parseOptions: strict }
    ),
  },
  (input) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const administration = yield* InvoiceAdministrationService;
          const result = yield* administration.retry(input.invoiceId);
          yield* Effect.sync(() => {
            revalidateLocalizedPath("/admin/invoices");
            revalidateLocalizedPath(`/admin/invoices/${input.invoiceId}`);
          });
          return result;
        })
      ),
      Effect.provide(InvoiceAdministrationService.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "Invoice delivery could not be retried.",
            cause,
          })
      )
    )
);

export const createAdministrationInvoice: typeof createInvoiceAction = async (
  ...args: Parameters<typeof createInvoiceAction>
) => {
  "use server";
  return await createInvoiceAction(...args);
};

export const previewAdministrationInvoice: typeof previewInvoiceAction = async (
  ...args: Parameters<typeof previewInvoiceAction>
) => {
  "use server";
  return await previewInvoiceAction(...args);
};

export const searchAdministrationInvoiceCustomers: typeof searchCustomersAction =
  async (...args: Parameters<typeof searchCustomersAction>) => {
    "use server";
    return await searchCustomersAction(...args);
  };

export const retryAdministrationInvoice: typeof retryInvoiceAction = async (
  ...args: Parameters<typeof retryInvoiceAction>
) => {
  "use server";
  return await retryInvoiceAction(...args);
};
