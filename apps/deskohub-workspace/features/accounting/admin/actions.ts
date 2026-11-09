"use server";

import {
  AdministrationCustomerSearchQuery,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { Effect, Match, Schema } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import type { WorkspaceActionFailureCopy } from "@/shared/backend/workspace-action";
import { InvoiceAdministrationService } from "./invoice-administration.service";
import { getInvoiceCustomerErrorMessage } from "./invoice-display";

const strict = { errors: "all", onExcessProperty: "error" } as const;

const failureCopy: WorkspaceActionFailureCopy = {
  timeout: m.accountingActionTimedOut,
  unexpected: m.accountingActionFailedUnexpectedly,
};

const invoiceCreateInputSchema = Schema.toStandardSchemaV1(
  AdministrationInvoiceCreateInput,
  { parseOptions: strict }
);

const invoicePaths = (invoiceId: string) => [
  administrationHref("/[locale]/admin/invoices"),
  administrationHref("/[locale]/admin/invoices/[invoiceId]", { invoiceId }),
];

const createInvoiceAction = defineAdministrationAction(
  {
    operation: "invoice-administration.create",
    failureCopy,
    schema: invoiceCreateInputSchema,
    logInput: false,
    fallback: m.accountingInvoiceCreateFailed,
    capabilities: InvoiceAdministrationService.Live,
    // The service messages stay English: the administration API forwards
    // them to `dhw`.
    publicFailure: (cause, locale) =>
      Match.value(cause).pipe(
        Match.tag("InvoiceAdministrationCustomerError", ({ reason }) =>
          getInvoiceCustomerErrorMessage(reason, locale)
        ),
        Match.tag("InvoiceAdministrationInProgressError", () =>
          m.accountingInvoiceCreateInProgress({}, { locale })
        ),
        Match.orElse(() => undefined)
      ),
    revalidates: (_input, { invoiceId }: { readonly invoiceId: string }) =>
      invoicePaths(invoiceId),
  },
  Effect.fn(function* (input) {
    const administrator = yield* CurrentAdministrator;
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.create(input, {
      source: "admin-ui",
      administrator,
    });
  })
);

const previewInvoiceAction = defineAdministrationAction(
  {
    operation: "invoice-administration.preview",
    failureCopy,
    schema: invoiceCreateInputSchema,
    logInput: false,
    fallback: m.accountingInvoiceFormPreviewError,
    capabilities: InvoiceAdministrationService.Live,
  },
  Effect.fn(function* (input) {
    const administrator = yield* CurrentAdministrator;
    const administration = yield* InvoiceAdministrationService;
    const pdf = yield* administration.preview(input, {
      source: "admin-ui",
      administrator,
    });
    return {
      dataUrl: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
    };
  })
);

const searchCustomersAction = defineAdministrationAction(
  {
    operation: "invoice-administration.search-customers",
    failureCopy,
    schema: Schema.toStandardSchemaV1(AdministrationCustomerSearchQuery, {
      parseOptions: strict,
    }),
    logInput: false,
    fallback: m.accountingInvoiceCustomerSearchUnavailable,
    capabilities: InvoiceAdministrationService.Live,
  },
  Effect.fn(function* (input) {
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.searchCustomers(input.query);
  })
);

const retryInvoiceAction = defineAdministrationAction(
  {
    operation: "invoice-administration.retry-delivery",
    failureCopy,
    schema: Schema.toStandardSchemaV1(
      Schema.Struct({ invoiceId: AdministrationInvoiceId }),
      { parseOptions: strict }
    ),
    fallback: m.accountingInvoiceRetryDeliveryError,
    capabilities: InvoiceAdministrationService.Live,
    revalidates: ({ invoiceId }) => invoicePaths(invoiceId),
  },
  Effect.fn(function* (input) {
    const administration = yield* InvoiceAdministrationService;
    return yield* administration.retry(input.invoiceId);
  })
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
