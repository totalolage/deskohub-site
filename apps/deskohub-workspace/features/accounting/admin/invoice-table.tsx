"use client";

import { CircleAlert, Download, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationAlert,
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { retryAdministrationInvoice } from "./actions";
import type { InvoiceAdministrationListItem } from "./invoice-administration.service";
import { InvoicePaymentStatusBadge } from "./invoice-detail";
import { getInvoiceSourceLabel } from "./invoice-display";
import { type InvoiceListQuery, invoiceListQuery } from "./invoice-list-query";

/**
 * A list item with its issue time and total already formatted on the server:
 * the client's ICU spaces date-times and amounts differently from Node's.
 */
export type InvoiceAdministrationTableRow = InvoiceAdministrationListItem & {
  readonly issuedAtLabel: string;
  readonly totalLabel: string;
};

const getInvoiceColumns = (
  locale: Locale
): readonly AdministrationDataTableColumn<InvoiceAdministrationTableRow>[] => [
  {
    accessorKey: "invoiceNumber",
    header: m.accountingInvoiceColumnInvoice({}, { locale }),
    cell: ({ row }) => (
      <Link
        className="font-semibold underline underline-offset-4"
        href={administrationHref("/[locale]/admin/invoices/[invoiceId]", {
          invoiceId: row.original.id,
        })}
      >
        {row.original.invoiceNumber}
      </Link>
    ),
  },
  {
    id: "customer",
    accessorFn: (invoice) => invoice.customerName,
    header: m.accountingInvoiceColumnCustomer({}, { locale }),
  },
  {
    accessorKey: "issuedAt",
    header: m.accountingInvoiceColumnIssued({}, { locale }),
    cell: ({ row }) => row.original.issuedAtLabel,
  },
  {
    accessorKey: "total",
    header: m.accountingInvoiceColumnTotal({}, { locale }),
    cell: ({ row }) => row.original.totalLabel,
    meta: { cellClassName: "font-mono tabular-nums" },
  },
  {
    accessorKey: "paymentStatus",
    header: m.accountingInvoiceColumnPayment({}, { locale }),
    cell: ({ row }) => (
      <InvoicePaymentStatusBadge status={row.original.paymentStatus} />
    ),
  },
  {
    accessorKey: "source",
    header: m.accountingInvoiceColumnProvenance({}, { locale }),
    cell: ({ row }) => (
      <div>
        <p>{getInvoiceSourceLabel(row.original.source, locale)}</p>
        {row.original.actor && (
          <p className="text-xs text-navy-blue/55">{row.original.actor}</p>
        )}
      </div>
    ),
  },
  {
    id: "delivery",
    header: m.accountingInvoiceColumnDelivery({}, { locale }),
    accessorFn: (invoice) => invoice.needsAttention,
    cell: ({ row }) => <InvoiceDeliveryBadge invoice={row.original} />,
  },
];

function InvoiceDeliveryBadge({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationListItem;
}) {
  const locale = useRouteLocale();
  if (invoice.needsAttention) {
    return (
      <StatusBadge tone="attention">
        <CircleAlert aria-hidden className="size-3.5" />{" "}
        {m.accountingInvoiceDeliveryNeedsResend({}, { locale })}
      </StatusBadge>
    );
  }
  if (
    invoice.delivery.customer === "accepted" &&
    invoice.delivery.internal === "accepted"
  ) {
    return (
      <StatusBadge tone="positive">
        {m.accountingInvoiceDeliverySent({}, { locale })}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral">
      {m.accountingInvoiceDeliverySending({}, { locale })}
    </StatusBadge>
  );
}

export function InvoiceAdministrationTable({
  items,
  query,
}: {
  readonly items: readonly InvoiceAdministrationTableRow[];
  readonly query: InvoiceListQuery;
}) {
  const locale = useRouteLocale();
  return (
    <AdministrationDataTable
      ariaLabel={m.accountingInvoiceTableLabel({}, { locale })}
      columns={getInvoiceColumns(locale)}
      data={items}
      getRowId={(item) => item.id}
      {...invoiceListQuery.tableSorting(query)}
      renderActions={(item) => <InvoiceRowActions invoice={item} />}
      mobile={
        <ul className="divide-y divide-navy-blue/10">
          {items.map((invoice) => (
            <li className="p-4" key={invoice.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    className="font-semibold underline decoration-navy-blue/20 underline-offset-4 hover:decoration-navy-blue"
                    href={administrationHref(
                      "/[locale]/admin/invoices/[invoiceId]",
                      { invoiceId: invoice.id }
                    )}
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
                {invoice.totalLabel}
              </p>
              <p className="mt-1 text-xs text-navy-blue/60">
                {m.accountingInvoiceIssuedOn(
                  { issuedAt: invoice.issuedAtLabel },
                  { locale }
                )}
              </p>
              <div className="mt-3 flex items-start justify-between gap-3">
                <InvoiceDeliveryBadge invoice={invoice} />
                <InvoiceRowActions invoice={invoice} />
              </div>
            </li>
          ))}
        </ul>
      }
      tableClassName="min-w-[1120px]"
    />
  );
}

function InvoiceRowActions({
  invoice,
}: {
  readonly invoice: InvoiceAdministrationListItem;
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
    <div className="grid justify-items-end gap-1">
      <div className="flex justify-end gap-1">
        <Button
          asChild
          aria-label={m.accountingInvoiceDownloadLabel(
            { invoiceNumber: invoice.invoiceNumber },
            { locale }
          )}
          size="icon"
          variant="ghost"
        >
          <a
            download
            href={getLocalizedPagePath(
              locale,
              "/[locale]/admin/invoices/[invoiceId]/pdf",
              { invoiceId: invoice.id }
            )}
          >
            <Download aria-hidden className="size-4" />
          </a>
        </Button>
        {invoice.needsAttention && (
          <Button
            aria-label={m.accountingInvoiceRetryDeliveryLabel(
              { invoiceNumber: invoice.invoiceNumber },
              { locale }
            )}
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
