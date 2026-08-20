"use client";

import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { CircleAlert, Download, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationAlert,
  AdministrationDataTable,
  AdministrationStatusBadge,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { getAdministrationTableSortHref } from "@/features/administration/table-sort";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { retryAdministrationInvoice } from "./actions";
import type {
  InvoiceAdministrationListItem,
  InvoiceAdministrationListQuery,
} from "./invoice-administration.service";
import { InvoicePaymentStatusBadge } from "./invoice-detail";

const columns: readonly ColumnDef<InvoiceAdministrationListItem>[] = [
  {
    accessorKey: "invoiceNumber",
    header: "Invoice",
    cell: ({ row }) => (
      <Link
        className="font-semibold underline underline-offset-4"
        href={`/admin/invoices/${row.original.id}`}
      >
        {row.original.invoiceNumber}
      </Link>
    ),
  },
  {
    id: "customer",
    accessorFn: (invoice) => invoice.customerName,
    header: "Customer",
  },
  {
    accessorKey: "issuedAt",
    header: "Issued",
    cell: ({ row }) =>
      new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(row.original.issuedAt)),
  },
  {
    accessorKey: "total",
    header: "Total",
    cell: ({ row }) => `${row.original.total} ${row.original.currency}`,
    meta: { cellClassName: "font-mono tabular-nums" },
  },
  {
    accessorKey: "paymentStatus",
    header: "Payment",
    cell: ({ row }) => (
      <InvoicePaymentStatusBadge status={row.original.paymentStatus} />
    ),
  },
  {
    accessorKey: "source",
    header: "Provenance",
    cell: ({ row }) => (
      <div>
        <p>
          {
            {
              "reservation-request": "Reservation request",
              "post-order-link": "Post-order link",
              "admin-ui": "Admin UI",
              "dhw-cli": "dhw CLI",
              legacy: "Legacy / unknown",
            }[row.original.source]
          }
        </p>
        {row.original.actor && (
          <p className="text-xs text-navy-blue/55">{row.original.actor}</p>
        )}
      </div>
    ),
  },
  {
    id: "delivery",
    header: "Delivery",
    accessorFn: (invoice) => invoice.needsAttention,
    cell: ({ row }) => <InvoiceDeliveryBadge invoice={row.original} />,
  },
];

function InvoiceDeliveryBadge({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationListItem;
}) {
  if (invoice.needsAttention) {
    return (
      <AdministrationStatusBadge tone="attention">
        <CircleAlert aria-hidden className="size-3.5" /> Needs resend
      </AdministrationStatusBadge>
    );
  }
  if (
    invoice.delivery.customer === "accepted" &&
    invoice.delivery.internal === "accepted"
  ) {
    return (
      <AdministrationStatusBadge tone="positive">
        Sent
      </AdministrationStatusBadge>
    );
  }
  return (
    <AdministrationStatusBadge tone="neutral">
      Sending
    </AdministrationStatusBadge>
  );
}

export function InvoiceAdministrationTable({
  items,
  query,
}: {
  readonly items: readonly InvoiceAdministrationListItem[];
  readonly query: InvoiceAdministrationListQuery;
}) {
  const sorting: SortingState = query.sort
    ? [{ id: query.sort, desc: query.direction === "desc" }]
    : [];
  return (
    <AdministrationDataTable
      ariaLabel="Invoices"
      columns={columns}
      data={items}
      getRowId={(item) => item.id}
      getSortHref={(field, direction) =>
        getAdministrationTableSortHref({
          basePath: "/admin/invoices",
          field,
          direction,
        })
      }
      renderActions={(item) => <InvoiceRowActions invoice={item} />}
      mobile={
        <ul className="divide-y divide-navy-blue/10">
          {items.map((invoice) => (
            <li className="p-4" key={invoice.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    className="font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
                    href={`/admin/invoices/${invoice.id}`}
                  >
                    {invoice.invoiceNumber}
                  </Link>
                  <p className="mt-1 truncate text-sm text-navy-blue/65">
                    {invoice.customerName}
                  </p>
                </div>
                <InvoicePaymentStatusBadge status={invoice.paymentStatus} />
              </div>
              <p className="mt-3 font-mono text-sm font-semibold tabular-nums">
                {invoice.total} {invoice.currency}
              </p>
              <p className="mt-1 text-xs text-navy-blue/60">
                Issued {formatAdministrationDateTime(invoice.issuedAt)}
              </p>
              <div className="mt-3 flex items-start justify-between gap-3">
                <InvoiceDeliveryBadge invoice={invoice} />
                <InvoiceRowActions invoice={invoice} />
              </div>
            </li>
          ))}
        </ul>
      }
      sorting={sorting}
      tableClassName="min-w-[1120px]"
    />
  );
}

export function InvoiceRowActions({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationListItem;
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
    <div className="grid justify-items-end gap-1">
      <div className="flex justify-end gap-1">
        <Button
          asChild
          aria-label={`Download ${invoice.invoiceNumber}`}
          size="icon"
          variant="ghost"
        >
          <a download href={`/admin/invoices/${invoice.id}/pdf`}>
            <Download aria-hidden className="size-4" />
          </a>
        </Button>
        {invoice.needsAttention && (
          <Button
            aria-label={`Retry delivery for ${invoice.invoiceNumber}`}
            disabled={isExecuting}
            onClick={() => {
              setError(null);
              execute({ invoiceId: invoice.id });
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <RotateCw aria-hidden className="size-4" />
          </Button>
        )}
      </div>
      {error && (
        <AdministrationAlert
          className="max-w-56 text-left text-xs"
          role="alert"
          status="error"
        >
          {error}
        </AdministrationAlert>
      )}
    </div>
  );
}
