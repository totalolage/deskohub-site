"use client";

import { useMemo } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import type { AdministrationCustomerTransaction } from "@/features/administration/administration.service";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { getAdministrationPaymentStatus } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import { NexiOrderLink } from "@/features/administration/nexi-order-link";
import { PaymentAmount } from "@/features/administration/payment-status";
import { getAdministrationReservationProductTitle } from "@/features/administration/reservation-product";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { formatMoney } from "@/shared/money/money";
import { getClaimReleaseReasonLabel } from "./claim-release-reason";
import { CustomerPromotionCodeAction } from "./customer-admin-client";
import type {
  AdminCustomerProfile,
  AdminDiscountCodeClaim,
} from "./discount-administration.service";

type Money = AdminDiscountCodeClaim["appliedAmount"];

type CustomerPromotionCodeItem =
  | {
      readonly kind: "discount-code";
      readonly id: AdminCustomerProfile["codes"][number]["id"];
      readonly audienceSize: number;
      readonly code: string;
      readonly discountAdjustment: DiscountAdjustment;
      readonly discountLabel: string;
      readonly eligible: boolean;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "voucher";
      readonly id: AdminCustomerProfile["vouchers"][number]["id"];
      readonly audienceSize: number;
      readonly code: string;
      readonly eligible: boolean;
      readonly enabled: boolean;
      readonly issuedCredit: Money;
      readonly remainingCredit: Money;
    };

/**
 * Times arrive formatted from the server: formatting them in this client tree
 * would differ from the server render and fail hydration.
 */
export type ClaimHistoryItem = {
  readonly id: string;
  readonly kind: CustomerPromotionCodeItem["kind"];
  readonly appliedAmount: Money;
  /** The claimed code or voucher; `code` is null when its value is not loaded. */
  readonly promotion: { readonly id: string; readonly code: string | null };
  readonly dotyposCustomerId: string;
  readonly redeemedAt: string | null;
  readonly releasedAt: string | null;
  readonly releaseReason: string | null;
  readonly reservedAt: string;
  readonly reservedAtLabel: string;
  /** When the claim was redeemed or released, if it was. */
  readonly completedAtLabel: string | null;
  readonly state: AdminDiscountCodeClaim["state"];
  readonly workspaceReservationId: string;
};

/** A transaction whose time arrives formatted from the server. */
export type CustomerTransactionTableItem = AdministrationCustomerTransaction & {
  readonly updatedAtLabel: string;
};

const getPromotionCodeKindLabel = (
  kind: CustomerPromotionCodeItem["kind"],
  locale: Locale
) =>
  kind === "voucher"
    ? m.discountsPromotionKindVoucher({}, { locale })
    : m.discountsPromotionKindDiscountCode({}, { locale });

const getClaimStateLabel = (
  state: AdminDiscountCodeClaim["state"],
  locale: Locale
) =>
  ({
    reserved: m.discountsClaimStateReserved,
    redeemed: m.discountsClaimStateRedeemed,
    released: m.discountsClaimStateReleased,
  })[state]({}, { locale });

const getPromotionCodeHref = (item: {
  readonly id: string;
  readonly kind: CustomerPromotionCodeItem["kind"];
}) =>
  item.kind === "voucher"
    ? administrationHref("/[locale]/admin/vouchers/[voucherId]", {
        voucherId: item.id,
      })
    : administrationHref("/[locale]/admin/codes/[codeId]", { codeId: item.id });

const getPromotionCodeBenefit = (
  item: CustomerPromotionCodeItem,
  locale: Locale
) => {
  if (item.kind === "voucher") {
    return m.discountsVoucherCreditBenefit(
      { amount: formatMoney(item.issuedCredit, locale) },
      { locale }
    );
  }
  return `${item.discountLabel} · ${
    item.discountAdjustment.kind === "percentage"
      ? formatDiscountAdjustment(item.discountAdjustment, locale)
      : formatMoney(item.discountAdjustment.amount, locale)
  }`;
};

const getPromotionCodeAvailability = (
  item: CustomerPromotionCodeItem,
  locale: Locale
) => {
  if (item.audienceSize === 0)
    return m.discountsAvailabilityAll({}, { locale });
  if (item.eligible && item.audienceSize === 1) {
    return m.discountsAvailabilityOnlyCustomer({}, { locale });
  }
  return m.discountsAvailabilitySelectedCustomers(
    { count: item.audienceSize },
    { locale }
  );
};

export function CustomerPromotionCodeTable({
  customerId,
  customerName,
  items,
}: {
  readonly customerId: AdminCustomerProfile["customer"]["id"];
  readonly customerName: string;
  readonly items: readonly CustomerPromotionCodeItem[];
}) {
  const locale = useRouteLocale();
  const columns = useMemo<
    AdministrationDataTableColumn<CustomerPromotionCodeItem>[]
  >(
    () => [
      {
        accessorKey: "code",
        header: m.discountsColumnCode({}, { locale }),
        cell: ({ row }) => (
          <Link
            className="font-mono font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
            href={getPromotionCodeHref(row.original)}
          >
            {row.original.code}
          </Link>
        ),
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorFn: (item) => getPromotionCodeKindLabel(item.kind, locale),
        id: "type",
        header: m.discountsColumnType({}, { locale }),
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorFn: (item) => getPromotionCodeBenefit(item, locale),
        id: "benefit",
        header: m.discountsColumnBenefit({}, { locale }),
        cell: ({ row }) => (
          <>
            {getPromotionCodeBenefit(row.original, locale)}
            {row.original.kind === "voucher" && (
              <span className="mt-0.5 block text-xs text-navy-blue/65">
                {m.discountsVoucherCreditRemaining(
                  {
                    amount: formatMoney(row.original.remainingCredit, locale),
                  },
                  { locale }
                )}
              </span>
            )}
          </>
        ),
        meta: { cellClassName: "break-words" },
      },
      {
        accessorKey: "enabled",
        header: m.discountsColumnStatus({}, { locale }),
        cell: ({ row }) => (
          <StatusBadge tone={row.original.enabled ? "positive" : "neutral"}>
            {row.original.enabled
              ? m.discountsStatusEnabled({}, { locale })
              : m.discountsStatusDisabled({}, { locale })}
          </StatusBadge>
        ),
      },
      {
        accessorKey: "audienceSize",
        header: m.discountsColumnAvailability({}, { locale }),
        cell: ({ row }) => getPromotionCodeAvailability(row.original, locale),
      },
      {
        id: "action",
        header: () => (
          <span className="sr-only">
            {m.discountsColumnManageEligibility({}, { locale })}
          </span>
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <CustomerPromotionCodeAction
            audienceSize={row.original.audienceSize}
            code={row.original.code}
            customerId={customerId}
            customerName={customerName}
            eligible={row.original.eligible}
            promotion={
              row.original.kind === "voucher"
                ? { kind: "voucher", id: row.original.id }
                : { kind: "discount-code", id: row.original.id }
            }
          />
        ),
        meta: { cellClassName: "relative z-10 text-right" },
      },
    ],
    [customerId, customerName, locale]
  );

  return (
    <AdministrationDataTable
      ariaLabel={m.discountsCustomerCodesTableLabel({}, { locale })}
      columns={columns}
      data={items}
      getRowId={(item) => `${item.kind}:${item.id}`}
      tableClassName="min-w-[760px]"
    />
  );
}

export function CustomerTransactionHistoryTable({
  transactions,
}: {
  readonly transactions: readonly CustomerTransactionTableItem[];
}) {
  const locale = useRouteLocale();
  const columns = useMemo<
    AdministrationDataTableColumn<CustomerTransactionTableItem>[]
  >(
    () => [
      {
        accessorFn: ({ attempt }) => attempt.updatedAt,
        id: "date",
        header: m.discountsColumnDate({}, { locale }),
        cell: ({ row }) => row.original.updatedAtLabel,
        meta: {
          cellClassName: "whitespace-nowrap text-navy-blue/68",
        },
      },
      {
        accessorFn: ({ attempt }) => attempt.state,
        id: "status",
        header: m.discountsColumnStatus({}, { locale }),
        cell: ({ row }) => {
          const { attempt } = row.original;
          const status = getAdministrationPaymentStatus(attempt, locale);
          return (
            <StatusBadge
              tone={
                attempt.state === "paid" && !status.refunded
                  ? "positive"
                  : "neutral"
              }
            >
              {status.label}
            </StatusBadge>
          );
        },
      },
      {
        accessorFn: ({ reservation }) =>
          getAdministrationReservationProductTitle(reservation.product, locale),
        id: "reservation",
        header: m.discountsColumnReservation({}, { locale }),
        cell: ({ row }) => (
          <Link
            className="font-semibold underline decoration-navy-blue/20 underline-offset-4"
            href={administrationHref(
              "/[locale]/admin/reservations/[reservationId]",
              { reservationId: row.original.reservation.id }
            )}
          >
            {getAdministrationReservationProductTitle(
              row.original.reservation.product,
              locale
            )}
          </Link>
        ),
      },
      {
        accessorFn: ({ attempt }) => attempt.amount.value,
        id: "amount",
        header: m.discountsColumnAmount({}, { locale }),
        cell: ({ row }) => (
          <PaymentAmount locale={locale} payment={row.original.attempt} />
        ),
        meta: { cellClassName: "whitespace-nowrap font-semibold" },
      },
      {
        accessorFn: ({ attempt }) => attempt.providerOrderId ?? attempt.id,
        id: "paymentId",
        header: m.discountsColumnPaymentId({}, { locale }),
        cell: ({ row }) =>
          row.original.attempt.providerOrderId ? (
            <NexiOrderLink
              className="font-mono text-xs"
              locale={locale}
              orderId={row.original.attempt.providerOrderId}
            />
          ) : (
            <span className="font-mono text-xs">{row.original.attempt.id}</span>
          ),
      },
    ],
    [locale]
  );

  return (
    <AdministrationDataTable
      ariaLabel={m.discountsCustomerTransactionsTableLabel({}, { locale })}
      columns={columns}
      data={transactions}
      getRowId={({ attempt }) => attempt.id}
      tableClassName="min-w-[760px]"
    />
  );
}

/**
 * Claims shown either for one code or voucher, where each row names its
 * customer, or for one customer, where each row names the claimed code or
 * voucher and its type.
 */
export function ClaimHistoryTable({
  ariaLabel,
  claims,
  subject,
}: {
  readonly ariaLabel: string;
  readonly claims: readonly ClaimHistoryItem[];
  readonly subject: "customer" | "promotion-code";
}) {
  const locale = useRouteLocale();
  const columns = useMemo<AdministrationDataTableColumn<ClaimHistoryItem>[]>(
    () => [
      subject === "customer"
        ? {
            accessorKey: "dotyposCustomerId",
            header: m.discountsColumnCustomer({}, { locale }),
            cell: ({ row }) => (
              <Link
                className="font-semibold underline underline-offset-4"
                href={administrationHref(
                  "/[locale]/admin/customers/[customerId]",
                  { customerId: row.original.dotyposCustomerId }
                )}
              >
                {m.discountsViewCustomer({}, { locale })}
              </Link>
            ),
          }
        : {
            accessorFn: (claim) => claim.promotion.code ?? claim.promotion.id,
            id: "code",
            header: m.discountsColumnCode({}, { locale }),
            cell: ({ row }) => (
              <Link
                className="font-mono font-semibold underline underline-offset-4"
                href={getPromotionCodeHref({
                  id: row.original.promotion.id,
                  kind: row.original.kind,
                })}
              >
                {row.original.promotion.code ??
                  (row.original.kind === "voucher"
                    ? m.discountsViewVoucher({}, { locale })
                    : m.discountsViewDiscountCode({}, { locale }))}
              </Link>
            ),
            meta: { cellClassName: "whitespace-nowrap" },
          },
      ...(subject === "promotion-code"
        ? [
            {
              accessorFn: (claim: ClaimHistoryItem) =>
                getPromotionCodeKindLabel(claim.kind, locale),
              id: "type",
              header: m.discountsColumnType({}, { locale }),
              meta: { cellClassName: "whitespace-nowrap" },
            } satisfies AdministrationDataTableColumn<ClaimHistoryItem>,
          ]
        : []),
      {
        accessorKey: "state",
        header: m.discountsColumnState({}, { locale }),
        cell: ({ row }) => (
          <>
            <StatusBadge
              tone={row.original.state === "released" ? "neutral" : "positive"}
            >
              {getClaimStateLabel(row.original.state, locale)}
            </StatusBadge>
            {row.original.releaseReason && (
              <p className="mt-1 max-w-48 text-xs text-navy-blue/65">
                {getClaimReleaseReasonLabel(row.original.releaseReason, locale)}
              </p>
            )}
          </>
        ),
      },
      {
        accessorFn: (claim) => claim.appliedAmount.value,
        id: "amount",
        header: m.discountsColumnAmount({}, { locale }),
        cell: ({ row }) => formatMoney(row.original.appliedAmount, locale),
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorKey: "reservedAt",
        header: m.discountsColumnReserved({}, { locale }),
        cell: ({ row }) => row.original.reservedAtLabel,
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorFn: (claim) => claim.redeemedAt ?? claim.releasedAt ?? "",
        id: "completed",
        header: m.discountsColumnCompleted({}, { locale }),
        cell: ({ row }) => row.original.completedAtLabel ?? "—",
        meta: { cellClassName: "whitespace-nowrap" },
      },
      {
        accessorKey: "workspaceReservationId",
        header: m.discountsColumnReservation({}, { locale }),
        cell: ({ row }) => (
          <Link
            className="font-semibold underline underline-offset-4"
            href={administrationHref(
              "/[locale]/admin/reservations/[reservationId]",
              { reservationId: row.original.workspaceReservationId }
            )}
          >
            {m.discountsOpenReservation({}, { locale })}
          </Link>
        ),
      },
    ],
    [locale, subject]
  );

  return (
    <AdministrationDataTable
      ariaLabel={ariaLabel}
      columns={columns}
      data={claims}
      getRowId={(claim) => `${claim.kind}:${claim.id}`}
      tableClassName="min-w-[820px]"
    />
  );
}
