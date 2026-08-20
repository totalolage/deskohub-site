import { BigDecimal } from "effect";
import { Suspense } from "react";
import {
  InvoiceDeliverySummary,
  InvoiceDetailActions,
  InvoicePaymentStatusBadge,
} from "@/features/accounting/admin/invoice-detail";
import { loadInvoiceAdministrationDetail } from "@/features/accounting/admin/page-data.server";
import {
  AdministrationDetailSection,
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { AdministrationRouteLoading } from "@/features/administration/loading";

export default function InvoiceAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly invoiceId: string }>;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <InvoiceDetailContent params={params} />
    </Suspense>
  );
}

async function InvoiceDetailContent({
  params,
}: {
  readonly params: Promise<{ readonly invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const invoice = await loadInvoiceAdministrationDetail(invoiceId);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={<InvoiceDetailActions invoice={invoice} />}
        description={`${invoice.customerName} · ${invoice.total} ${invoice.currency}`}
        eyebrow="Invoice"
        title={invoice.invoiceNumber}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-2xl border border-navy-blue/10 bg-white">
          <iframe
            className="h-[75vh] min-h-[40rem] w-full"
            src={invoice.pdfUrl}
            title={`PDF for ${invoice.invoiceNumber}`}
          />
        </section>
        <div className="space-y-6">
          <AdministrationDetailSection title="Payment">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-navy-blue/60">Status</dt>
                <dd className="mt-1">
                  <InvoicePaymentStatusBadge status={invoice.paymentStatus} />
                </dd>
              </div>
              {invoice.dueDate &&
                BigDecimal.isPositive(
                  BigDecimal.fromStringUnsafe(invoice.total)
                ) && (
                  <div>
                    <dt className="text-navy-blue/60">Due date</dt>
                    <dd className="font-semibold">{invoice.dueDate}</dd>
                  </div>
                )}
              {invoice.paidOn && (
                <div>
                  <dt className="text-navy-blue/60">Paid on</dt>
                  <dd className="font-semibold">{invoice.paidOn}</dd>
                </div>
              )}
            </dl>
          </AdministrationDetailSection>
          <AdministrationDetailSection title="Delivery">
            <InvoiceDeliverySummary delivery={invoice.delivery} />
          </AdministrationDetailSection>
          <AdministrationDetailSection title="Provenance">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-navy-blue/60">Source</dt>
                <dd className="font-semibold">{invoice.source}</dd>
              </div>
              <div>
                <dt className="text-navy-blue/60">Actor</dt>
                <dd className="font-semibold">
                  {invoice.actor ?? "Legacy / unknown"}
                </dd>
              </div>
              <div>
                <dt className="text-navy-blue/60">Issued</dt>
                <dd className="font-semibold">
                  {new Intl.DateTimeFormat("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(invoice.issuedAt))}
                </dd>
              </div>
            </dl>
          </AdministrationDetailSection>
        </div>
      </div>
    </AdministrationPage>
  );
}
