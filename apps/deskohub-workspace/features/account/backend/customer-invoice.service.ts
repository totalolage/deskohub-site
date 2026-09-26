import "server-only";

import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { renderInvoicePdf } from "@/features/accounting/backend/invoice-pdf";
import {
  type CustomerInvoiceSummary,
  renderCustomerInvoiceCsv,
} from "@/features/accounting/customer-invoice";
import type { Locale } from "@/features/i18n";
import type { LinkedCustomerAccount } from "../customer-account";
import { AccountFeatureFlagService } from "./account-feature-flag.service";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAccountResolver } from "./customer-account-resolver.service";

export class CustomerInvoicesUnavailableError extends Data.TaggedError(
  "CustomerInvoicesUnavailableError"
)<{
  readonly message: string;
}> {}

export class CustomerInvoicesLoadError extends Data.TaggedError(
  "CustomerInvoicesLoadError"
)<{
  readonly message: string;
}> {}

export class CustomerInvoiceNotFoundError extends Data.TaggedError(
  "CustomerInvoiceNotFoundError"
)<{
  readonly invoiceId: string;
}> {}

const unavailable = () =>
  new CustomerInvoicesUnavailableError({
    message: "Customer invoices are unavailable for this account.",
  });

const toUnavailable = () => unavailable();

const toLoadError = () =>
  new CustomerInvoicesLoadError({
    message: "Customer invoices could not be loaded.",
  });

const AccountingStorageLive = Layer.mergeAll(
  WorkspaceDatabase.Default,
  AccountingSnapshotKeyService.Default
);

const DependenciesLive = Layer.mergeAll(
  AccountFeatureFlagService.Live,
  CustomerAccountResolver.Live,
  CustomerAccountLinkRepository.Live,
  InvoiceRepository.Default.pipe(
    Layer.provide(
      Layer.merge(
        AccountingStorageLive,
        AccountingDocumentSnapshotRepository.Default.pipe(
          Layer.provide(AccountingStorageLive)
        )
      )
    )
  )
);

interface ICustomerInvoiceService {
  /**
   * Lists the linked customer's issued invoices. Re-authorizes the account
   * feature flag, the verified session, the durable link, and the
   * non-deletion-pending activity state on every call.
   */
  readonly list: Effect.Effect<
    readonly CustomerInvoiceSummary[],
    CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
  >;
  /**
   * Renders the linked customer's own invoice as a PDF. A missing or
   * non-owned invoice is the same not-found failure; a database, decryption,
   * or renderer failure fails closed as a load error without the document.
   */
  readonly findPdf: (
    invoiceId: string
  ) => Effect.Effect<
    { readonly bytes: Buffer; readonly fileName: string },
    | CustomerInvoiceNotFoundError
    | CustomerInvoicesUnavailableError
    | CustomerInvoicesLoadError
  >;
  readonly buildCsv: (
    locale: Locale
  ) => Effect.Effect<
    { readonly fileName: string; readonly content: string },
    CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
  >;
}

export class CustomerInvoiceService extends Context.Service<
  CustomerInvoiceService,
  ICustomerInvoiceService
>()("@deskohub-workspace/account/CustomerInvoiceService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const flag = yield* AccountFeatureFlagService;
      const resolver = yield* CustomerAccountResolver;
      const links = yield* CustomerAccountLinkRepository;
      const invoiceRepository = yield* InvoiceRepository;

      // Every customer invoice request re-authorizes from the authoritative
      // database session, the active durable link, and the deletion marker;
      // nothing is cached between requests.
      const authorize: Effect.Effect<
        LinkedCustomerAccount,
        CustomerInvoicesUnavailableError
      > = Effect.gen(function* () {
        const enabled = yield* flag.isEnabled;
        if (!enabled) return yield* unavailable();
        const account = yield* resolver.resolve.pipe(
          Effect.mapError(toUnavailable)
        );
        yield* requireAccountActivity(links, account.accountId).pipe(
          Effect.mapError(toUnavailable)
        );
        return account;
      });

      const list = authorize.pipe(
        Effect.flatMap((account) =>
          invoiceRepository
            .listForCustomer(account.dotyposCustomerId)
            .pipe(Effect.mapError(toLoadError))
        )
      );

      const findPdf = (invoiceId: string) =>
        authorize.pipe(
          Effect.flatMap((account) =>
            invoiceRepository
              .findForCustomer(account.dotyposCustomerId, invoiceId)
              .pipe(Effect.mapError(toLoadError))
          ),
          Effect.flatMap((invoice) =>
            invoice
              ? Effect.succeed(invoice)
              : Effect.fail(new CustomerInvoiceNotFoundError({ invoiceId }))
          ),
          Effect.flatMap((invoice) =>
            renderInvoicePdf(invoice.document).pipe(
              Effect.map(
                (
                  bytes
                ): { readonly bytes: Buffer; readonly fileName: string } => ({
                  bytes,
                  fileName: `${invoice.invoiceNumber}.pdf`,
                })
              )
            )
          ),
          Effect.catchTag("InvoicePdfRenderingError", () =>
            Effect.fail(toLoadError())
          )
        );

      const buildCsv = Effect.fn("CustomerInvoiceService.buildCsv")(function* (
        locale: Locale
      ) {
        const summaries = yield* list;
        return {
          fileName: "deskohub-invoices.csv",
          content: renderCustomerInvoiceCsv(summaries, locale),
        };
      });

      return { list, findPdf, buildCsv } satisfies ICustomerInvoiceService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(DependenciesLive));
}
