import { Suspense } from "react";
import { InvoiceSettlement } from "@/features/accounting/invoice-settlement";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import {
  AdministrationDetailSection,
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import {
  formatAdministrationDateTime,
  formatAdministrationPlainDate,
} from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import {
  InvoiceDeliverySummary,
  InvoiceDetailActions,
  InvoicePaymentStatusBadge,
} from "./invoice-detail";
import { formatInvoiceTotal, getInvoiceSourceLabel } from "./invoice-display";
import { loadInvoiceAdministrationDetail } from "./page-data.server";

export async function InvoiceAdministrationDetailScreen({
  params,
}: {
  readonly params: Promise<{ readonly invoiceId: string }>;
}) {
  const locale = await getRequestLocale();
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <InvoiceDetailContent locale={locale} params={params} />
    </Suspense>
  );
}

async function InvoiceDetailContent({
  locale,
  params,
}: {
  readonly locale: Locale;
  readonly params: Promise<{ readonly invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const invoice = await loadInvoiceAdministrationDetail(invoiceId);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={<InvoiceDetailActions invoice={invoice} />}
        description={m.accountingInvoiceDetailDescription(
          {
            customerName: invoice.customerName,
            total: formatInvoiceTotal(invoice, locale),
          },
          { locale }
        )}
        eyebrow={m.accountingInvoiceDetailEyebrow({}, { locale })}
        title={invoice.invoiceNumber}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-2xl border border-navy-blue/10 bg-white">
          <iframe
            className="h-[75vh] min-h-[40rem] w-full"
            src={localizeAdministrationHref(invoice.pdfUrl, locale)}
            title={m.accountingInvoiceDetailPdfTitle(
              { invoiceNumber: invoice.invoiceNumber },
              { locale }
            )}
          />
        </section>
        <div className="space-y-6">
          <AdministrationDetailSection
            title={m.accountingInvoiceDetailPaymentSection({}, { locale })}
          >
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-navy-blue/60">
                  {m.accountingInvoiceDetailStatus({}, { locale })}
                </dt>
                <dd className="mt-1">
                  <InvoicePaymentStatusBadge status={invoice.paymentStatus} />
                </dd>
              </div>
              {InvoiceSettlement.$is("PaymentRequested")(
                invoice.settlement
              ) && (
                <div>
                  <dt className="text-navy-blue/60">
                    {m.accountingInvoiceDetailDueDate({}, { locale })}
                  </dt>
                  <dd className="font-semibold">
                    {formatAdministrationPlainDate(
                      invoice.settlement.dueDate,
                      locale
                    )}
                  </dd>
                </div>
              )}
              {invoice.paidOn && (
                <div>
                  <dt className="text-navy-blue/60">
                    {m.accountingInvoiceDetailPaidOn({}, { locale })}
                  </dt>
                  <dd className="font-semibold">
                    {formatAdministrationPlainDate(invoice.paidOn, locale)}
                  </dd>
                </div>
              )}
            </dl>
          </AdministrationDetailSection>
          <AdministrationDetailSection
            title={m.accountingInvoiceDetailDeliverySection({}, { locale })}
          >
            <InvoiceDeliverySummary delivery={invoice.delivery} />
          </AdministrationDetailSection>
          <AdministrationDetailSection
            title={m.accountingInvoiceDetailProvenanceSection({}, { locale })}
          >
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-navy-blue/60">
                  {m.accountingInvoiceDetailSource({}, { locale })}
                </dt>
                <dd className="font-semibold">
                  {getInvoiceSourceLabel(invoice.source, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-navy-blue/60">
                  {m.accountingInvoiceDetailActor({}, { locale })}
                </dt>
                <dd className="font-semibold">
                  {invoice.actor ??
                    m.accountingInvoiceSourceLegacy({}, { locale })}
                </dd>
              </div>
              <div>
                <dt className="text-navy-blue/60">
                  {m.accountingInvoiceDetailIssued({}, { locale })}
                </dt>
                <dd className="font-semibold">
                  {formatAdministrationDateTime(invoice.issuedAt, locale)}
                </dd>
              </div>
            </dl>
          </AdministrationDetailSection>
        </div>
      </div>
    </AdministrationPage>
  );
}
