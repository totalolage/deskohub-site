"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import type { AdministrationCustomerTransaction } from "@/features/administration/administration.service";
import { AdministrationDataTable } from "@/features/administration/data-table";
import {
  formatAdministrationDateTime,
  formatAdministrationMoney,
} from "@/features/administration/formatters";
import { NexiOrderLink } from "@/features/administration/nexi-order-link";
import { AdministrationStatusBadge } from "@/features/administration/status-badge";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import { CustomerCodeAction } from "./customer-admin-client";
import type {
  AdminCustomerProfile,
  AdminDiscountCodeClaim,
} from "./discount-administration.service";

type Money = AdminDiscountCodeClaim["appliedAmount"];

type CustomerCodeEligibilityItem = {
  readonly id: AdminCustomerProfile["codes"][number]["id"];
  readonly audienceSize: number;
  readonly code: string;
  readonly discountAdjustment: DiscountAdjustment;
  readonly discountLabel: string;
  readonly eligible: boolean;
  readonly enabled: boolean;
};

type CustomerVoucherEligibilityItem = {
  readonly id: AdminCustomerProfile["vouchers"][number]["id"];
  readonly audienceSize: number;
  readonly code: string;
  readonly eligible: boolean;
  readonly issuedCredit: Money;
  readonly remainingCredit: Money;
};

type ClaimHistoryItem = {
  readonly id: string;
  readonly appliedAmount: Money;
  readonly codeId?: string;
  readonly dotyposCustomerId: string;
  readonly redeemedAt: string | null;
  readonly releasedAt: string | null;
  readonly releaseReason: string | null;
  readonly reservedAt: string;
  readonly state: AdminDiscountCodeClaim["state"];
  readonly voucherId?: string;
  readonly workspaceReservationId: string;
};

const getDiscountLabel = (code: CustomerCodeEligibilityItem) =>
  `${code.discountLabel} · ${
    code.discountAdjustment.kind === "percentage"
      ? `${code.discountAdjustment.basisPoints / 100}%`
      : formatAdministrationMoney(code.discountAdjustment.amount)
  }`;

const getCustomerCodeAvailability = (code: CustomerCodeEligibilityItem) => {
  if (!code.eligible) return "Available to all";
  if (code.audienceSize === 1) return "Only this customer";
  return `${code.audienceSize} selected customers`;
};

const getCustomerVoucherAvailability = (
  voucher: CustomerVoucherEligibilityItem
) => {
  if (voucher.audienceSize === 0) return "Available to all";
  if (voucher.eligible) return `${voucher.audienceSize} selected customers`;
  return "Restricted";
};

export function CustomerCodeEligibilityTable({
  codes,
  customerId,
  customerName,
}: {
  readonly codes: readonly CustomerCodeEligibilityItem[];
  readonly customerId: AdminCustomerProfile["customer"]["id"];
  readonly customerName: string;
}) {
  const columns = useMemo<ColumnDef<CustomerCodeEligibilityItem>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <Link
            className="font-mono font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
            href={`/admin/codes/${row.original.id}`}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorKey: "discountLabel",
        header: "Discount",
        cell: ({ row }) => getDiscountLabel(row.original),
        meta: { cellClassName: "break-words" },
      },
      {
        accessorKey: "enabled",
        header: "Status",
        cell: ({ row }) => (
          <AdministrationStatusBadge
            tone={row.original.enabled ? "positive" : "neutral"}
          >
            {row.original.enabled ? "Enabled" : "Disabled"}
          </AdministrationStatusBadge>
        ),
      },
      {
        accessorKey: "audienceSize",
        header: "Availability",
        cell: ({ row }) => getCustomerCodeAvailability(row.original),
      },
      {
        id: "action",
        header: () => <span className="sr-only">Manage eligibility</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <CustomerCodeAction
            audienceSize={row.original.audienceSize}
            code={row.original.code}
            codeId={row.original.id}
            customerId={customerId}
            customerName={customerName}
            eligible={row.original.eligible}
          />
        ),
        meta: { cellClassName: "relative z-10 text-right" },
      },
    ],
    [customerId, customerName]
  );

  return (
    <AdministrationDataTable
      ariaLabel="Customer code eligibility"
      columns={columns}
      data={codes}
      getRowId={(code) => code.id}
      tableClassName="min-w-[720px]"
    />
  );
}

export function CustomerVoucherEligibilityTable({
  vouchers,
}: {
  readonly vouchers: readonly CustomerVoucherEligibilityItem[];
}) {
  const columns = useMemo<ColumnDef<CustomerVoucherEligibilityItem>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Voucher",
        cell: ({ row }) => (
          <Link
            className="font-mono font-semibold underline underline-offset-4"
            href={`/admin/vouchers/${row.original.id}`}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorFn: (voucher) => voucher.issuedCredit.value,
        id: "issuedCredit",
        header: "Issued",
        cell: ({ row }) => formatAdministrationMoney(row.original.issuedCredit),
      },
      {
        accessorFn: (voucher) => voucher.remainingCredit.value,
        id: "remainingCredit",
        header: "Remaining",
        cell: ({ row }) =>
          formatAdministrationMoney(row.original.remainingCredit),
      },
      {
        accessorKey: "audienceSize",
        header: "Availability",
        cell: ({ row }) => getCustomerVoucherAvailability(row.original),
      },
    ],
    []
  );

  return (
    <AdministrationDataTable
      ariaLabel="Customer voucher eligibility"
      columns={columns}
      data={vouchers}
      getRowId={(voucher) => voucher.id}
    />
  );
}

export function CustomerTransactionHistoryTable({
  transactions,
}: {
  readonly transactions: readonly AdministrationCustomerTransaction[];
}) {
  const columns = useMemo<ColumnDef<AdministrationCustomerTransaction>[]>(
    () => [
      {
        accessorFn: ({ attempt }) => attempt.updatedAt,
        id: "date",
        header: "Date",
        cell: ({ row }) =>
          formatAdministrationDateTime(row.original.attempt.updatedAt),
        meta: {
          cellClassName: "whitespace-nowrap text-navy-blue/68",
        },
      },
      {
        accessorFn: ({ attempt }) => attempt.state,
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <AdministrationStatusBadge
            tone={
              row.original.attempt.state === "paid" ? "positive" : "neutral"
            }
          >
            {row.original.attempt.stateLabel}
          </AdministrationStatusBadge>
        ),
      },
      {
        accessorFn: ({ reservation }) => reservation.typeLabel,
        id: "reservation",
        header: "Reservation",
        cell: ({ row }) => (
          <Link
            className="font-semibold underline decoration-navy-blue/20 underline-offset-4"
            href={`/admin/reservations/${row.original.reservation.id}`}
          >
            {row.original.reservation.typeLabel}
          </Link>
        ),
      },
      {
        accessorFn: ({ attempt }) => attempt.amount.value,
        id: "amount",
        header: "Amount",
        cell: ({ row }) =>
          formatAdministrationMoney(row.original.attempt.amount),
        meta: { cellClassName: "whitespace-nowrap font-semibold" },
      },
      {
        accessorFn: ({ attempt }) => attempt.providerOrderId ?? attempt.id,
        id: "paymentId",
        header: "Payment ID",
        cell: ({ row }) =>
          row.original.attempt.providerOrderId ? (
            <NexiOrderLink
              className="font-mono text-xs"
              orderId={row.original.attempt.providerOrderId}
            />
          ) : (
            <span className="font-mono text-xs">{row.original.attempt.id}</span>
          ),
      },
    ],
    []
  );

  return (
    <AdministrationDataTable
      ariaLabel="Customer transaction history"
      columns={columns}
      data={transactions}
      getRowId={({ attempt }) => attempt.id}
      tableClassName="min-w-[760px]"
    />
  );
}

export function ClaimHistoryTable({
  claims,
  resource,
}: {
  readonly claims: readonly ClaimHistoryItem[];
  readonly resource: "code" | "code-customer" | "voucher" | "voucher-customer";
}) {
  const isVoucher = resource.startsWith("voucher");
  const showsCustomer = resource.endsWith("customer");
  const subjectLabel = isVoucher ? "Voucher" : "Discount code";
  const columns = useMemo<ColumnDef<ClaimHistoryItem>[]>(
    () => [
      {
        accessorFn: (claim) =>
          showsCustomer
            ? claim.dotyposCustomerId
            : (claim.codeId ?? claim.voucherId),
        id: "subject",
        header: showsCustomer ? "Customer" : subjectLabel,
        cell: ({ row }) => (
          <Link
            className="font-semibold underline underline-offset-4"
            href={
              showsCustomer
                ? `/admin/customers/${row.original.dotyposCustomerId}`
                : getClaimSubjectHref(row.original)
            }
          >
            View {showsCustomer ? "customer" : resource}
          </Link>
        ),
      },
      {
        accessorKey: "state",
        header: "State",
        cell: ({ row }) => (
          <>
            <AdministrationStatusBadge
              tone={row.original.state === "released" ? "neutral" : "positive"}
            >
              {row.original.state[0]?.toUpperCase()}
              {row.original.state.slice(1)}
            </AdministrationStatusBadge>
            {row.original.releaseReason && (
              <p className="mt-1 max-w-48 text-xs text-navy-blue/65">
                {row.original.releaseReason}
              </p>
            )}
          </>
        ),
      },
      {
        accessorFn: (claim) => claim.appliedAmount.value,
        id: "amount",
        header: "Amount",
        cell: ({ row }) =>
          formatAdministrationMoney(row.original.appliedAmount),
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorKey: "reservedAt",
        header: "Reserved",
        cell: ({ row }) =>
          formatAdministrationDateTime(row.original.reservedAt),
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorFn: (claim) => claim.redeemedAt ?? claim.releasedAt ?? "",
        id: "completed",
        header: "Completed",
        cell: ({ row }) =>
          row.original.redeemedAt || row.original.releasedAt
            ? formatAdministrationDateTime(
                row.original.redeemedAt ?? row.original.releasedAt ?? ""
              )
            : "—",
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorKey: "workspaceReservationId",
        header: "Reservation",
        cell: ({ row }) => (
          <Link
            className="font-semibold underline underline-offset-4"
            href={`/admin/reservations/${row.original.workspaceReservationId}`}
          >
            Open reservation
          </Link>
        ),
      },
    ],
    [resource, showsCustomer, subjectLabel]
  );

  return (
    <AdministrationDataTable
      ariaLabel={`${subjectLabel} claim history`}
      columns={columns}
      data={claims}
      getRowId={(claim) => claim.id}
      tableClassName="min-w-[820px]"
    />
  );
}

const getClaimSubjectHref = (claim: ClaimHistoryItem) =>
  claim.codeId
    ? `/admin/codes/${claim.codeId}`
    : `/admin/vouchers/${claim.voucherId}`;
