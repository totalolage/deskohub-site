import { Context, Data, Effect, Layer } from "effect";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import {
  type InvoicePdfFile,
  renderInvoicePdfFile,
} from "@/features/accounting/backend/invoice-pdf";
import {
  type CustomerInvoiceSummary,
  getCustomerInvoiceCsvColumns,
  getCustomerInvoiceSummary,
} from "@/features/accounting/customer-invoice";
import type { Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";
import type { CsvColumn } from "@/shared/utils/csv";
import { currentPlainDate, type PlainDate } from "@/shared/utils/temporal";
import {
  isCustomerAccountAccessDenial,
  type LinkedCustomerAccount,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAccountResolver } from "./customer-account-resolver.service";

/**
 * The session has no active account whose invoices it may see: signed out,
 * no linked Dotypos customer, a review account, or deletion pending.
 */
export class CustomerInvoicesUnavailableError extends Data.TaggedError(
  "CustomerInvoicesUnavailableError"
) {}

/** No invoice of the account's customer has this id. */
export class CustomerInvoiceNotFoundError extends Data.TaggedError(
  "CustomerInvoiceNotFoundError"
) {}

/** Which step failed; the only detail a load failure keeps or logs. */
export type CustomerInvoiceLoadFailureCode =
  | "account.authority"
  | "invoice.read"
  | "invoice.pdf";

/**
 * The account or its invoices couldn't be read. It keeps a fixed code, never
 * the database, decryption, or renderer cause.
 */
export class CustomerInvoicesLoadError extends Data.TaggedError(
  "CustomerInvoicesLoadError"
)<{
  readonly code: CustomerInvoiceLoadFailureCode;
}> {}

/** The account's invoice export, ready for `createCsvDownloadResponse`. */
interface CustomerInvoiceExport {
  readonly filename: string;
  readonly columns: readonly CsvColumn<CustomerInvoiceSummary>[];
  readonly rows: readonly CustomerInvoiceSummary[];
}

interface ICustomerInvoiceService {
  /** The account's issued invoices, newest issue first. */
  readonly list: Effect.Effect<
    readonly CustomerInvoiceSummary[],
    CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
  >;
  /**
   * One of the account's invoices as a PDF file. Another customer's invoice,
   * an unknown id, and text that is no invoice id are all not found.
   */
  readonly pdf: (
    invoiceId: string
  ) => Effect.Effect<
    InvoicePdfFile,
    | CustomerInvoiceNotFoundError
    | CustomerInvoicesUnavailableError
    | CustomerInvoicesLoadError
  >;
  /** The account's invoices as CSV rows with headers in `locale`. */
  readonly csv: (
    locale: Locale
  ) => Effect.Effect<
    CustomerInvoiceExport,
    CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
  >;
}

/**
 * A signed-in customer's own issued invoices. Every operation re-authorizes
 * from the authoritative session: it resolves the account's Dotypos customer
 * and re-reads the account's activity, so a deletion request or a removed
 * login stops it, and reads only that customer's invoices.
 */
export class CustomerInvoiceService extends Context.Service<
  CustomerInvoiceService,
  ICustomerInvoiceService
>()("@deskohub-workspace/account/CustomerInvoiceService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const resolver = yield* CustomerAccountResolver;
      const links = yield* CustomerAccountLinkRepository;
      const invoices = yield* InvoiceRepository;

      const authorize: Effect.Effect<
        LinkedCustomerAccount,
        CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
      > = resolver.resolve.pipe(
        Effect.tap((account) =>
          requireAccountActivity(links, account.accountId)
        ),
        Effect.catchTag(
          "CustomerAccountAccessError",
          (
            error
          ): Effect.Effect<
            never,
            CustomerInvoicesUnavailableError | CustomerInvoicesLoadError
          > =>
            isCustomerAccountAccessDenial(error)
              ? Effect.fail(new CustomerInvoicesUnavailableError())
              : failLoad("account.authority")
        )
      );

      const listWithToday = (
        account: LinkedCustomerAccount
      ): Effect.Effect<
        {
          readonly today: PlainDate;
          readonly summaries: readonly CustomerInvoiceSummary[];
        },
        CustomerInvoicesLoadError
      > =>
        Effect.Do.pipe(
          Effect.bind("issued", () =>
            invoices
              .listForCustomer(account.dotyposCustomerId)
              .pipe(Effect.catch(() => failLoad("invoice.read")))
          ),
          Effect.bind("today", () => currentPlainDate(workspaceTimeZone)),
          Effect.map(({ issued, today }) => ({
            today,
            summaries: issued.map((invoice) =>
              getCustomerInvoiceSummary(invoice, today)
            ),
          }))
        );

      const list = authorize.pipe(
        Effect.flatMap(listWithToday),
        Effect.map(({ summaries }) => summaries),
        Effect.withSpan("CustomerInvoiceService.list")
      );

      const pdf = Effect.fn("CustomerInvoiceService.pdf")(function* (
        invoiceId: string
      ) {
        const account = yield* authorize;
        const invoice = yield* invoices
          .findForCustomer(account.dotyposCustomerId, invoiceId)
          .pipe(Effect.catch(() => failLoad("invoice.read")));
        if (!invoice) return yield* new CustomerInvoiceNotFoundError();
        return yield* renderInvoicePdfFile(invoice.document).pipe(
          Effect.catch(() => failLoad("invoice.pdf"))
        );
      });

      const csv = Effect.fn("CustomerInvoiceService.csv")(function* (
        locale: Locale
      ) {
        const { today, summaries } = yield* authorize.pipe(
          Effect.flatMap(listWithToday)
        );
        return {
          filename: `invoices-${today}.csv`,
          columns: getCustomerInvoiceCsvColumns(locale),
          rows: summaries,
        } satisfies CustomerInvoiceExport;
      });

      return { list, pdf, csv } satisfies ICustomerInvoiceService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountResolver.Live,
        CustomerAccountLinkRepository.Live,
        InvoiceRepository.Live
      )
    )
  );
}

const workspaceTimeZone = workspaceSiteConstants.location.timeZone;

/** Logs the step's fixed code, never its cause, and fails with it. */
const failLoad = (code: CustomerInvoiceLoadFailureCode) =>
  Effect.logError("Customer invoices could not be loaded", {
    failureCode: code,
  }).pipe(Effect.andThen(Effect.fail(new CustomerInvoicesLoadError({ code }))));
