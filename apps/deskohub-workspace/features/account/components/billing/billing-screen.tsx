import { Download, FileDown, Plus, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { FutureFeatureTooltip } from "@/features/account/components/future-feature-tooltip";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

/*
 * THESIS: Billing stays honest about unavailable account capabilities instead of
 * presenting placeholder payment data or invoice rows.
 * OWN-WORLD: Sculpin, navy, slate, and white surfaces extend the account shell
 * with compact controls and quiet empty states.
 * STORY: Visitors see what billing supports, understand what is unavailable,
 * and continue into their own billing details.
 * FIRST VIEWPORT: One padded billing card places title/currency, payment methods,
 * billing details, invoice history, and the caller-owned footer in one stack.
 * FORM: This shell never owns form markup, fields, values, or persistence; the caller owns them.
 */

export interface BillingScreenCopy {
  readonly title: string;
  readonly currency: string;
  readonly paymentMethodsTitle: string;
  readonly paymentMethodsUnavailable: string;
  readonly addPaymentCard: string;
  readonly removePaymentCard: string;
  readonly billingDetailsTitle: string;
  readonly syncAres: string;
  readonly aresUnavailable: string;
  readonly invoiceHistoryTitle: string;
  readonly invoiceHistoryUnavailable: string;
  readonly downloadInvoice: string;
  readonly exportInvoices: string;
}

export interface BillingScreenProps {
  readonly copy: BillingScreenCopy;
  readonly locale: Locale;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function BillingScreen({
  children,
  copy,
  footer,
  locale,
}: BillingScreenProps) {
  const instanceId = useId();
  const titleId = `${instanceId}-billing-title`;
  const paymentMethodsTitleId = `${instanceId}-payment-methods-title`;
  const billingDetailsTitleId = `${instanceId}-billing-details-title`;
  const aresUnavailableId = `${instanceId}-ares-unavailable`;
  const invoiceHistoryTitleId = `${instanceId}-invoice-history-title`;
  const invoiceHistoryUnavailableId = `${instanceId}-invoice-history-unavailable`;

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 rounded-2xl border border-[#dfe4ec] bg-white p-4 text-navy-blue shadow-[0_18px_40px_-28px_rgba(0,2,79,0.45)] sm:p-8"
    >
      <header className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:justify-between">
        <h2
          id={titleId}
          className="min-w-0 flex-1 break-words text-[26px] font-semibold leading-tight tracking-[-0.025em] text-navy-blue"
        >
          {copy.title}
        </h2>
        <span className="max-w-full shrink-0 break-words rounded-full bg-[#f1f4f8] px-3 py-1.5 text-sm font-semibold text-[#51627c]">
          {copy.currency}
        </span>
      </header>

      <hr className="my-7 h-px border-0 bg-[#e6ebf1]" />

      <section aria-labelledby={paymentMethodsTitleId} className="min-w-0">
        <h3
          id={paymentMethodsTitleId}
          className="break-words text-[15px] font-bold uppercase tracking-[0.075em] text-[#344258]"
        >
          {copy.paymentMethodsTitle}
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
                {copy.addPaymentCard}
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
              {copy.billingDetailsTitle}
            </h3>
            <p
              id={aresUnavailableId}
              className="mt-2 max-w-[65ch] min-w-0 break-words text-sm leading-6 text-[#51627c]"
            >
              {copy.aresUnavailable}
            </p>
          </div>
          <FutureFeatureTooltip locale={locale}>
            <Button
              aria-describedby={aresUnavailableId}
              className="h-auto max-w-full shrink-0 whitespace-normal text-left text-[#53657f] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
              disabled
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 break-words">{copy.syncAres}</span>
            </Button>
          </FutureFeatureTooltip>
        </div>
        <div className="mt-6 min-w-0">{children}</div>
      </section>

      <hr className="my-7 h-px border-0 bg-[#e6ebf1]" />

      <section aria-labelledby={invoiceHistoryTitleId} className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <h3
            id={invoiceHistoryTitleId}
            className="min-w-0 flex-1 break-words text-lg font-semibold text-[#344258]"
          >
            {copy.invoiceHistoryTitle}
          </h3>
          <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto">
            <FutureFeatureTooltip locale={locale}>
              <Button
                aria-describedby={invoiceHistoryUnavailableId}
                className="h-auto max-w-full whitespace-normal text-left text-[#53657f] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
                disabled
                size="sm"
                type="button"
                variant="secondary"
              >
                <Download aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {copy.downloadInvoice}
                </span>
              </Button>
            </FutureFeatureTooltip>
            <FutureFeatureTooltip locale={locale}>
              <Button
                aria-describedby={invoiceHistoryUnavailableId}
                className="h-auto max-w-full whitespace-normal text-left text-[#53657f] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
                disabled
                size="sm"
                type="button"
                variant="secondary"
              >
                <FileDown aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {copy.exportInvoices}
                </span>
              </Button>
            </FutureFeatureTooltip>
          </div>
        </div>
        <div className="mt-4 min-w-0 rounded-2xl border border-[#e0e6ee] bg-[#fbfcfd] px-4 py-5">
          <p
            id={invoiceHistoryUnavailableId}
            className="min-w-0 break-words text-sm leading-6 text-[#51627c]"
          >
            {copy.invoiceHistoryUnavailable}
          </p>
        </div>
      </section>

      {footer !== undefined && (
        <div className="mt-8 min-w-0 border-t border-[#e6ebf1] pt-6">
          {footer}
        </div>
      )}
    </section>
  );
}
