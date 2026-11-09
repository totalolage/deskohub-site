import { Download, FileDown, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { FutureFeatureTooltip } from "@/features/account/components/future-feature-tooltip";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

/*
 * THESIS: Billing stays honest about unavailable account capabilities instead of
 * presenting placeholder payment data or invoice rows.
 * OWN-WORLD: Sculpin, navy, slate, and white surfaces extend the account shell
 * with compact controls and quiet empty states.
 * STORY: Visitors see what billing supports, understand what is unavailable,
 * and continue into their own billing details.
 * FIRST VIEWPORT: One padded billing card places title, payment methods,
 * billing details, invoice history, and the caller-owned footer in one stack.
 * FORM: This shell never owns form markup, fields, values, or persistence; the caller owns them.
 */

export interface BillingScreenProps {
  readonly locale: Locale;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function BillingScreen({
  children,
  footer,
  locale,
}: BillingScreenProps) {
  const instanceId = useId();
  const titleId = `${instanceId}-billing-title`;
  const paymentMethodsTitleId = `${instanceId}-payment-methods-title`;
  const billingDetailsTitleId = `${instanceId}-billing-details-title`;
  const invoiceHistoryTitleId = `${instanceId}-invoice-history-title`;
  const invoiceHistoryUnavailableId = `${instanceId}-invoice-history-unavailable`;

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
        <div className="mt-4 grid min-w-0 gap-4 @xl:grid-cols-2">
          <FutureFeatureTooltip locale={locale}>
            <Button disabled type="button" variant="tile">
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
        <h3
          id={billingDetailsTitleId}
          className="min-w-0 break-words text-lg font-semibold text-[#344258]"
        >
          {m.accountBillingDetailsTitle({}, { locale })}
        </h3>
        <div className="mt-6 min-w-0">{children}</div>
      </section>

      <hr className="my-7 h-px border-0 bg-[#e6ebf1]" />

      <section aria-labelledby={invoiceHistoryTitleId} className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <h3
            id={invoiceHistoryTitleId}
            className="min-w-0 flex-1 break-words text-lg font-semibold text-[#344258]"
          >
            {m.accountBillingInvoiceHistoryTitle({}, { locale })}
          </h3>
          <div className="flex w-full min-w-0 flex-wrap gap-2 @xl:w-auto">
            <FutureFeatureTooltip locale={locale}>
              <Button
                aria-describedby={invoiceHistoryUnavailableId}
                disabled
                size="sm"
                type="button"
                variant="secondary"
                wrap
              >
                <Download aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {m.accountBillingDownloadInvoice({}, { locale })}
                </span>
              </Button>
            </FutureFeatureTooltip>
            <FutureFeatureTooltip locale={locale}>
              <Button
                aria-describedby={invoiceHistoryUnavailableId}
                disabled
                size="sm"
                type="button"
                variant="secondary"
                wrap
              >
                <FileDown aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {m.accountBillingExportInvoices({}, { locale })}
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
            {m.accountBillingInvoiceHistoryUnavailable({}, { locale })}
          </p>
        </div>
      </section>
    </AccountSectionPanel>
  );
}
