"use client";

import { Download, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AdministrationAlert,
  AdministrationStatusBadge,
} from "@/features/administration/components";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { retryAdministrationInvoice } from "./actions";
import type { InvoiceAdministrationDetail } from "./invoice-administration.service";

export function InvoicePaymentStatusBadge({
  status,
}: {
  readonly status: InvoiceAdministrationDetail["paymentStatus"];
}) {
  return (
    <AdministrationStatusBadge
      tone={
        {
          paid: "positive",
          issued: "neutral",
          due: "attention",
          overdue: "attention",
        }[status] as "positive" | "neutral" | "attention"
      }
    >
      {
        { paid: "Paid", issued: "Issued", due: "Due", overdue: "Overdue" }[
          status
        ]
      }
    </AdministrationStatusBadge>
  );
}

export function InvoiceDetailActions({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationDetail;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(
    retryAdministrationInvoice,
    {
      actionName: "retryAdministrationInvoice",
      onSuccess: () => {
        setError(null);
        router.refresh();
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ?? "Invoice delivery could not be retried."
        ),
      onTransportError: () =>
        setError("Invoice delivery could not be retried."),
    }
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a download href={invoice.pdfUrl}>
            <Download aria-hidden className="size-4" /> Download PDF
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
            {isExecuting ? "Retrying…" : "Retry delivery"}
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
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {(["customer", "internal"] as const).map((audience) => (
        <div
          className="rounded-xl border border-navy-blue/10 p-4"
          key={audience}
        >
          <dt className="text-sm capitalize text-navy-blue/60">{audience}</dt>
          <dd className="mt-2">
            <AdministrationStatusBadge
              tone={
                {
                  accepted: "positive",
                  failed: "attention",
                  missing: "neutral",
                  processing: "neutral",
                }[delivery[audience]] as "positive" | "attention" | "neutral"
              }
            >
              {delivery[audience]}
            </AdministrationStatusBadge>
          </dd>
        </div>
      ))}
    </dl>
  );
}
