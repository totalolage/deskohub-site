import { FileDown, Plus, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, use, useId } from "react";
import { FutureFeatureTooltip } from "@/features/account/components/future-feature-tooltip";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import type { CustomerInvoiceListState } from "@/features/account/contracts";
import type { CustomerInvoiceSummary } from "@/features/accounting/customer-invoice";
import { formatInvoiceAmount } from "@/features/accounting/customer-invoice";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/*
 * THESIS: Billing stays honest about unavailable account capabilities instead of
 * presenting placeholder payment data or invoice rows.
 * OWN-WORLD: Sculpin, navy, slate, and white surfaces extend the account shell
 * with compact controls and quiet empty states.
 * STORY: Visitors see what billing supports, understand what is unavailable,
 * download their issued invoices, and continue into their own billing details.
 * FIRST VIEWPORT: One padded billing card places title, payment methods,
 * billing details, invoice history, and the caller-owned footer in one stack.
 * FORM: This shell never owns form markup, fields, values, or persistence; the caller owns them.
 */

export interface BillingScreenProps {
  readonly invoices:
    | CustomerInvoiceListState
    | Promise<CustomerInvoiceListState>;
  readonly locale: Locale;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function BillingScreen({
  children,
  footer,
  invoices,
  locale,
}: BillingScreenProps) {
  const instanceId = useId();
  const titleId = `${instanceId}-billing-title`;
  const paymentMethodsTitleId = `${instanceId}-payment-methods-title`;
  const billingDetailsTitleId = `${instanceId}-billing-details-title`;
  return (
    <AccountSectionPanel
      className="min-w-0"
      footer={footer}
      title={m.accountSectionBilling({}, { locale })}
      titleId={titleId}
    >
      <section aria-labelledby={paymentMethodsTitleId} className="min-w-0">
        <h3
          id={paymentMethodsTitleId}
          className="break-words text-[15px] font-bold uppercase tracking-[0.075em] text-[#344258]"
        >
          {m.accountBillingPaymentMethodsTitle({}, { locale })}
        </h3>
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          <FutureFeatureTooltip locale={locale}>
            <Button
              className="flex h-auto min-h-[9rem] min-w-0 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#cbd7e5] bg-[#fbfcfd] px-4 py-6 text-center text-[#53657f] whitespace-normal hover:bg-[#fbfcfd] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
              disabled
              type="button"
              variant="ghost"
            >
              <Plus
                aria-hidden="true"
                className="size-5 shrink-0 text-[#8291a6]"
              />
              <span className="min-w-0 max-w-full break-words">
                {m.accountBillingAddPaymentCard({}, { locale })}
              </span>
            </Button>
          </FutureFeatureTooltip>
        </div>
      </section>

      <hr className="my-7 h-px border-0 bg-[#e6ebf1]" />

      <section aria-labelledby={billingDetailsTitleId} className="min-w-0">
        <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3
              id={billingDetailsTitleId}
              className="min-w-0 break-words text-lg font-semibold text-[#344258]"
            >
              {m.accountBillingDetailsTitle({}, { locale })}
            </h3>
          </div>
          <FutureFeatureTooltip locale={locale}>
            <Button
              className="h-auto max-w-full shrink-0 whitespace-normal text-left text-[#53657f] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
              disabled
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 break-words">
                {m.accountBillingSyncAres({}, { locale })}
              </span>
            </Button>
          </FutureFeatureTooltip>
        </div>
        <div className="mt-6 min-w-0">{children}</div>
      </section>

      <hr className="my-7 h-px border-0 bg-[#e6ebf1]" />

      <Suspense
        fallback={
          <InvoiceHistory invoices={{ kind: "loading" }} locale={locale} />
        }
      >
        <ResolvedInvoiceHistory invoices={invoices} locale={locale} />
      </Suspense>
    </AccountSectionPanel>
  );
}

function ResolvedInvoiceHistory({
  invoices,
  locale,
}: {
  readonly invoices:
    | CustomerInvoiceListState
    | Promise<CustomerInvoiceListState>;
  readonly locale: Locale;
}) {
  const state = "then" in invoices ? use(invoices) : invoices;
  return <InvoiceHistory invoices={state} locale={locale} />;
}

function InvoiceHistory({
  invoices,
  locale,
}: {
  readonly invoices: CustomerInvoiceListState;
  readonly locale: Locale;
}) {
  const instanceId = useId();
  const invoiceHistoryTitleId = `${instanceId}-invoice-history-title`;
  const invoiceHistoryStateId = `${instanceId}-invoice-history-state`;
  const canExport = invoices.kind === "populated";

  return (
    <section aria-labelledby={invoiceHistoryTitleId} className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <h3
          id={invoiceHistoryTitleId}
          className="min-w-0 flex-1 break-words text-lg font-semibold text-[#344258]"
        >
          {m.accountBillingInvoiceHistoryTitle({}, { locale })}
        </h3>
        <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto">
          {canExport ? (
            <a
              aria-describedby={invoiceHistoryStateId}
              className="inline-flex h-auto max-w-full items-center justify-center gap-2 whitespace-normal rounded-xl border border-[#cbd7e5] bg-white px-4 py-2 text-sm font-semibold text-[#344258] transition-colors hover:bg-[#f2f6fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
              download
              href={`/${locale}/account/invoices/export`}
            >
              <FileDown aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 break-words">
                {m.accountBillingExportInvoices({}, { locale })}
              </span>
            </a>
          ) : (
            <Button
              aria-describedby={invoiceHistoryStateId}
              className="h-auto max-w-full whitespace-normal text-left text-[#53657f] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
              disabled
              size="sm"
              type="button"
              variant="secondary"
            >
              <FileDown aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 break-words">
                {m.accountBillingExportInvoices({}, { locale })}
              </span>
            </Button>
          )}
        </div>
      </div>
      <div className="mt-4 min-w-0 rounded-2xl border border-[#e0e6ee] bg-[#fbfcfd] px-4 py-5">
        <p
          id={invoiceHistoryStateId}
          className="min-w-0 break-words text-sm leading-6 text-[#51627c]"
        >
          {getInvoiceStateCopy(invoices, locale)}
        </p>
        {invoices.kind === "populated" && (
          <ul className="mt-4 min-w-0 divide-y divide-[#e6ebf1]">
            {invoices.invoices.map((invoice) => (
              <li
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
                key={invoice.id}
              >
                <div className="min-w-0">
                  <p className="min-w-0 break-words text-sm font-semibold text-[#344258]">
                    {invoice.invoiceNumber}
                  </p>
                  <p className="min-w-0 break-words text-xs leading-5 text-[#51627c]">
                    {formatInvoiceListDate(invoice.issuedAt, locale)} ·{" "}
                    {formatInvoiceAmount(
                      invoice.total,
                      invoice.currency,
                      locale
                    )}{" "}
                    · {getInvoiceStatusCopy(invoice, locale)}
                    {invoice.dueDate
                      ? ` · ${m.invoiceManualDueDate({}, { locale })} ${formatInvoiceListPlainDate(invoice.dueDate, locale)}`
                      : ""}
                  </p>
                </div>
                {/* A plain anchor keeps the download out of any form
                    submission path and stays keyboard operable. */}
                <a
                  aria-label={m.accountBillingInvoiceDownloadAriaLabel(
                    { invoiceNumber: invoice.invoiceNumber },
                    { locale }
                  )}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[#cbd7e5] bg-white px-3 py-1.5 text-sm font-semibold text-[#344258] transition-colors hover:bg-[#f2f6fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
                  download
                  href={`/${locale}/account/invoices/${invoice.id}/pdf`}
                >
                  {m.accountBillingDownloadInvoice({}, { locale })}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const getInvoiceStateCopy = (
  invoices: CustomerInvoiceListState,
  locale: Locale
): string => {
  switch (invoices.kind) {
    case "populated":
      return "";
    case "empty":
      return m.accountBillingInvoiceEmpty({}, { locale });
    case "loading":
      return m.accountBillingInvoiceLoading({}, { locale });
    case "unavailable":
      return m.accountBillingInvoiceUnavailable({}, { locale });
    case "failed":
      return m.accountBillingInvoiceFailed({}, { locale });
  }
};

const getInvoiceStatusCopy = (
  invoice: CustomerInvoiceSummary,
  locale: Locale
): string =>
  invoice.paymentStatus === "paid"
    ? m.invoicePaidStatus({}, { locale })
    : m.invoiceManualUnpaid({}, { locale });

const formatInvoiceListDate = (value: string, locale: Locale) =>
  formatInstantDate({
    instant: Temporal.Instant.from(value),
    locale,
    timeZone: workspaceSiteConstants.location.timeZone,
  });

const formatInvoiceListPlainDate = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
