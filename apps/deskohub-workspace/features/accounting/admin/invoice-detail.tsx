"use client";

import { Download, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { AdministrationAlert } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { retryAdministrationInvoice } from "./actions";
import type { InvoiceAdministrationDetail } from "./invoice-administration.service";

export function InvoicePaymentStatusBadge({
  status,
}: {
  readonly status: InvoiceAdministrationDetail["paymentStatus"];
}) {
  const locale = useRouteLocale();
  return (
    <StatusBadge
      tone={
        {
          paid: "positive",
          issued: "neutral",
          due: "attention",
          overdue: "attention",
        }[status] as "positive" | "neutral" | "attention"
      }
    >
      {{
        paid: m.accountingInvoicePaymentPaid,
        issued: m.accountingInvoicePaymentIssued,
        due: m.accountingInvoicePaymentDue,
        overdue: m.accountingInvoicePaymentOverdue,
      }[status]({}, { locale })}
    </StatusBadge>
  );
}

export function InvoiceDetailActions({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationDetail;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(
    retryAdministrationInvoice,
    {
      onSuccess: () => {
        setError(null);
        router.refresh();
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ??
            m.accountingInvoiceRetryDeliveryError({}, { locale })
        ),
      onTransportError: () =>
        setError(m.accountingInvoiceRetryDeliveryError({}, { locale })),
    }
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a download href={localizeAdministrationHref(invoice.pdfUrl, locale)}>
            <Download aria-hidden className="size-4" />{" "}
            {m.accountingInvoiceDownloadPdf({}, { locale })}
          </a>
        </Button>
        {invoice.needsAttention && (
          <Button
            disabled={isExecuting}
            onClick={() => {
              setError(null);
              execute({ invoiceId: invoice.id });
            }}
            type="button"
          >
            <RotateCw aria-hidden className="size-4" />{" "}
            {isExecuting
              ? m.accountingInvoiceRetryingDelivery({}, { locale })
              : m.accountingInvoiceRetryDelivery({}, { locale })}
          </Button>
        )}
      </div>
      {error && (
        <AdministrationAlert role="alert" status="error">
          {error}
        </AdministrationAlert>
      )}
    </div>
  );
}

export function InvoiceDeliverySummary({
  delivery,
}: {
  readonly delivery: InvoiceAdministrationDetail["delivery"];
}) {
  const locale = useRouteLocale();
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {(["customer", "internal"] as const).map((audience) => (
        <div
          className="rounded-xl border border-navy-blue/10 p-4"
          key={audience}
        >
          <dt className="text-sm text-navy-blue/60">
            {{
              customer: m.accountingInvoiceDeliveryAudienceCustomer,
              internal: m.accountingInvoiceDeliveryAudienceInternal,
            }[audience]({}, { locale })}
          </dt>
          <dd className="mt-2">
            <StatusBadge
              tone={
                {
                  accepted: "positive",
                  failed: "attention",
                  missing: "neutral",
                  processing: "neutral",
                }[delivery[audience]] as "positive" | "attention" | "neutral"
              }
            >
              {{
                accepted: m.accountingInvoiceDeliveryStatusAccepted,
                failed: m.accountingInvoiceDeliveryStatusFailed,
                missing: m.accountingInvoiceDeliveryStatusMissing,
                processing: m.accountingInvoiceDeliveryStatusProcessing,
              }[delivery[audience]]({}, { locale })}
            </StatusBadge>
          </dd>
        </div>
      ))}
    </dl>
  );
}
