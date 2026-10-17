"use server";

import {
  AdministrationCustomerSearchQuery,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceId,
} from "@deskohub/workspace-admin-api";
import { Effect, Match, Schema } from "effect";
import { m } from "@/features/administration/i18n";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import {
  defineWorkspaceAction,
  type WorkspaceActionContext,
} from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { InvoiceAdministrationService } from "./invoice-administration.service";
import { getInvoiceCustomerErrorMessage } from "./invoice-display";

const strict = { errors: "all", onExcessProperty: "error" } as const;

const invoiceCreateInputSchema = Schema.toStandardSchemaV1(
  AdministrationInvoiceCreateInput,
  { parseOptions: strict }
);

type InvoiceCreateActionContext = WorkspaceActionContext<
  typeof invoiceCreateInputSchema
>;

const createInvoiceAction = defineWorkspaceAction(
  {
    operation: "invoice-administration.create",
    schema: invoiceCreateInputSchema,
    logInput: false,
  },
  Effect.fn(
    function* (input, _context: InvoiceCreateActionContext) {
      const administrator = yield* requireAdministratorAuthorization;
      const administration = yield* InvoiceAdministrationService;
      const result = yield* administration.create(input, {
        source: "admin-ui",
        administrator,
      });
      yield* Effect.sync(() => {
        revalidateLocalizedPath("/admin/invoices");
        revalidateLocalizedPath(`/admin/invoices/${result.invoiceId}`);
      });
      return result;
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(InvoiceAdministrationService.Live),
        Effect.mapError(
          (cause) =>
            new PublicSafeActionError({
              // The service messages stay English: the administration API
              // forwards them to `dhw`.
              message: Match.value(cause).pipe(
                Match.tag("InvoiceAdministrationCustomerError", ({ reason }) =>
                  getInvoiceCustomerErrorMessage(reason, locale)
                ),
                Match.tag("InvoiceAdministrationInProgressError", () =>
                  m.accountingInvoiceCreateInProgress({}, { locale })
                ),
                Match.orElse(() =>
                  m.accountingInvoiceCreateFailed({}, { locale })
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
    schema: invoiceCreateInputSchema,
    logInput: false,
  },
  Effect.fn(
    function* (input, _context: InvoiceCreateActionContext) {
      const administrator = yield* requireAdministratorAuthorization;
      const administration = yield* InvoiceAdministrationService;
      const pdf = yield* administration.preview(input, {
        source: "admin-ui",
        administrator,
      });
      return {
        dataUrl: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
      };
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(InvoiceAdministrationService.Live),
        Effect.mapError(
          (cause) =>
            new PublicSafeActionError({
              message: m.accountingInvoiceFormPreviewError({}, { locale }),
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
  (input, { locale }) =>
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
            message: m.accountingInvoiceCustomerSearchUnavailable(
              {},
              { locale }
            ),
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
  (input, { locale }) =>
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
            message: m.accountingInvoiceRetryDeliveryError({}, { locale }),
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
