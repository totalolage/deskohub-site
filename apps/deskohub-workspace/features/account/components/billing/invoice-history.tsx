import { Download, FileDown } from "lucide-react";
import { Suspense, use } from "react";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import type {
  CustomerInvoiceHistory,
  CustomerInvoiceHistoryItem,
} from "@/features/account/contracts";
import type { InvoicePaymentStatus } from "@/features/accounting/invoice-settlement";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  StatusBadge,
  type StatusTone,
} from "@/shared/components/ui/status-badge";

/*
 * The billing section's own panel beside the billing form: the account's
 * issued invoices with a PDF download each and a CSV export of all of them.
 * The history streams in after the page: the panel's title and a mounted
 * status region render at once, and two row-shaped skeletons hold the body
 * until the history resolves. Every text arrives formatted from the server.
 */

type InvoiceHistoryPanelProps = {
  /** The history, loaded apart from the page so it streams in on its own. */
  readonly history: Promise<CustomerInvoiceHistory>;
  readonly locale: Locale;
};

export function InvoiceHistoryPanel({
  history,
  locale,
}: InvoiceHistoryPanelProps) {
  return (
    <div className="min-w-0" data-slot="invoice-history">
      <AccountSectionPanel
        actions={
          <Suspense fallback={null}>
            <InvoiceExportLink history={history} locale={locale} />
          </Suspense>
        }
        title={m.accountBillingInvoiceHistoryTitle({}, { locale })}
      >
        <div className="sr-only" role="status">
          <Suspense fallback={m.accountBillingInvoiceLoading({}, { locale })}>
            <InvoiceHistoryLoaded history={history} />
          </Suspense>
        </div>
        <Suspense fallback={<InvoiceRowsSkeleton />}>
          <InvoiceHistoryBody history={history} locale={locale} />
        </Suspense>
      </AccountSectionPanel>
    </div>
  );
}

/** Empties the status region once the history has loaded. */
function InvoiceHistoryLoaded({
  history,
}: Pick<InvoiceHistoryPanelProps, "history">) {
  use(history);
  return null;
}

function InvoiceExportLink({ history, locale }: InvoiceHistoryPanelProps) {
  const loaded = use(history);
  return (
    loaded.kind === "populated" && (
      <Button asChild size="sm" variant="secondary" wrap>
        <a data-slot="invoice-export" download href={loaded.exportPath}>
          <FileDown aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 break-words">
            {m.accountBillingExportInvoices({}, { locale })}
          </span>
        </a>
      </Button>
    )
  );
}

function InvoiceHistoryBody({ history, locale }: InvoiceHistoryPanelProps) {
  const loaded = use(history);
  if (loaded.kind === "populated") {
    return <InvoiceRows invoices={loaded.invoices} locale={locale} />;
  }

  return (
    <p
      className="min-w-0 break-words text-sm leading-6 text-[#51627c]"
      data-slot={`invoice-history-${loaded.kind}`}
    >
      {{
        empty: m.accountBillingInvoiceEmpty,
        unavailable: m.accountBillingInvoiceHistoryUnavailable,
        failed: m.accountBillingInvoiceFailed,
      }[loaded.kind]({}, { locale })}
    </p>
  );
}

/*
 * One grid for the column labels and every row; the download column has a
 * fixed width so the labels line up with the cells. Below the container's
 * `@xl` width a row stacks: the invoice number on its own line, then two
 * columns with their own small labels; from `@xl` the shared column labels
 * replace them.
 */
const rowGridClassName =
  "grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 @xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_10rem] @xl:items-center @xl:gap-x-6";

const cellLabelClassName =
  "block text-xs font-semibold uppercase tracking-[0.06em] text-[#6b7a90] @xl:sr-only";

function InvoiceRows({
  invoices,
  locale,
}: {
  readonly invoices: readonly CustomerInvoiceHistoryItem[];
  readonly locale: Locale;
}) {
  const labels = {
    number: m.accountBillingInvoiceColumnNumber({}, { locale }),
    issuedOn: m.accountBillingInvoiceColumnIssueDate({}, { locale }),
    total: m.accountBillingInvoiceColumnTotal({}, { locale }),
    status: m.accountBillingInvoiceColumnStatus({}, { locale }),
  };

  return (
    <div className="min-w-0">
      <div
        aria-hidden="true"
        className={`${rowGridClassName} hidden border-b border-[#e6ebf1] pb-3 text-xs font-semibold uppercase tracking-[0.06em] text-[#6b7a90] @xl:grid`}
      >
        <span>{labels.number}</span>
        <span>{labels.issuedOn}</span>
        <span>{labels.total}</span>
        <span>{labels.status}</span>
      </div>
      <ul className="min-w-0 divide-y divide-[#e6ebf1]">
        {invoices.map(({ display, invoice, pdfPath }) => (
          <li
            className={`${rowGridClassName} py-4 first:pt-0 last:pb-0 @xl:first:pt-4`}
            data-slot="invoice-row"
            key={invoice.id}
          >
            <div className="col-span-2 min-w-0 @xl:col-span-1">
              <span className={cellLabelClassName}>{labels.number}</span>
              <span className="block break-words font-semibold text-[#00024f]">
                {invoice.invoiceNumber}
              </span>
            </div>
            <div className="min-w-0 text-sm text-[#344258]">
              <span className={cellLabelClassName}>{labels.issuedOn}</span>
              {display.issuedOn}
            </div>
            <div className="min-w-0 text-sm font-semibold text-[#00024f] tabular-nums">
              <span className={cellLabelClassName}>{labels.total}</span>
              {display.total}
            </div>
            <div className="col-span-2 min-w-0 @xl:col-span-1">
              <span className={cellLabelClassName}>{labels.status}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge
                  tone={
                    (
                      {
                        paid: "positive",
                        issued: "neutral",
                        due: "progress",
                        overdue: "attention",
                      } as const satisfies Record<
                        InvoicePaymentStatus,
                        StatusTone
                      >
                    )[invoice.paymentStatus]
                  }
                >
                  {display.status}
                </StatusBadge>
                {display.dueDate !== null && (
                  <span className="text-xs text-[#51627c]">
                    {m.accountBillingInvoiceDueOn(
                      { date: display.dueDate },
                      { locale }
                    )}
                  </span>
                )}
              </span>
            </div>
            <div className="col-span-2 min-w-0 @xl:col-span-1 @xl:justify-self-end">
              <Button asChild size="sm" variant="secondary" wrap>
                <a data-slot="invoice-pdf" download href={pdfPath}>
                  <Download aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 break-words">
                    {m.accountBillingDownloadInvoice({}, { locale })}
                    <span className="sr-only"> {invoice.invoiceNumber}</span>
                  </span>
                </a>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two rows in the history's own grid while it loads; hidden from readers. */
function InvoiceRowsSkeleton() {
  return (
    <ul
      aria-hidden="true"
      className="min-w-0 divide-y divide-[#e6ebf1]"
      data-slot="invoice-history-skeleton"
    >
      {[0, 1].map((row) => (
        <li
          className={`${rowGridClassName} py-4 first:pt-0 last:pb-0`}
          key={row}
        >
          <Skeleton className="col-span-2 h-5 w-36 max-w-full @xl:col-span-1" />
          <Skeleton className="h-5 w-24 max-w-full" />
          <Skeleton className="h-5 w-20 max-w-full" />
          <Skeleton className="col-span-2 h-6 w-24 max-w-full rounded-full @xl:col-span-1" />
          <Skeleton className="col-span-2 h-9 w-36 max-w-full rounded-full @xl:col-span-1 @xl:justify-self-end" />
        </li>
      ))}
    </ul>
  );
}
