"use server";

import {
  AdministrationCustomerSearchQuery,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import {
  InvoiceAdministrationCustomerError,
  InvoiceAdministrationInProgressError,
  InvoiceAdministrationService,
} from "./invoice-administration.service";

const strict = { errors: "all", onExcessProperty: "error" } as const;

const createInvoiceAction = defineWorkspaceAction(
  {
    operation: "invoice-administration.create",
    schema: Schema.toStandardSchemaV1(AdministrationInvoiceCreateInput, {
      parseOptions: strict,
    }),
    logInput: false,
  },
  (input) =>
    Effect.gen(function* () {
      const actor = yield* requireDiscountAdminAuthorization();
      const administration = yield* InvoiceAdministrationService;
      const result = yield* administration.create(input, {
        source: "admin-ui",
        actor,
      });
      yield* Effect.sync(() => {
        revalidatePath("/admin/invoices");
        revalidatePath(`/admin/invoices/${result.invoiceId}`);
      });
      return result;
    }).pipe(
      Effect.provide(InvoiceAdministrationService.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({ message: getCreateError(cause), cause })
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
  (input) =>
    Effect.gen(function* () {
      const actor = yield* requireDiscountAdminAuthorization();
      const administration = yield* InvoiceAdministrationService;
      const pdf = yield* administration.preview(input, {
        source: "admin-ui",
        actor,
      });
      return {
        dataUrl: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
      };
    }).pipe(
      Effect.provide(InvoiceAdministrationService.Live),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "The invoice preview could not be generated.",
            cause,
          })
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
    requireDiscountAdminAuthorization().pipe(
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
    requireDiscountAdminAuthorization().pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const administration = yield* InvoiceAdministrationService;
          const result = yield* administration.retry(input.invoiceId);
          yield* Effect.sync(() => {
            revalidatePath("/admin/invoices");
            revalidatePath(`/admin/invoices/${input.invoiceId}`);
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

const getCreateError = (cause: unknown) => {
  if (
    cause instanceof InvoiceAdministrationCustomerError ||
    cause instanceof InvoiceAdministrationInProgressError
  ) {
    return cause.message;
  }
  return "The invoice could not be created. Check the customer and invoice details, then try again.";
};
