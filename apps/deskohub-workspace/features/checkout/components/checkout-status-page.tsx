import { cva } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  MailCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import type {
  CheckoutStatusKind,
  CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout-status.service";
import {
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import { CheckoutFlowLayout } from "./checkout-flow-layout";
import { WorkspaceTableMapView } from "./workspace-table-map-view";

type CheckoutStatusPageProps = {
  readonly locale: Locale;
  readonly status: CheckoutStatusViewModel;
};

type SummaryRow = {
  readonly label: string;
  readonly value: string;
};

type StatusCopy = {
  readonly title: string;
  readonly lead: string;
  readonly tone: "success" | "pending" | "warning" | "failed" | "unknown";
  readonly Icon: typeof CheckCircle2;
};

const statusIconWrapperVariants = cva(
  "flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-8",
  {
    variants: {
      tone: {
        success:
          "bg-aquamarine-green/14 text-aquamarine-green ring-aquamarine-green/8",
        pending: "bg-burned-orange/12 text-burned-orange ring-burned-orange/8",
        warning: "bg-burned-orange/12 text-burned-orange ring-burned-orange/8",
        failed: "bg-red-500/10 text-red-600 ring-red-500/8",
        unknown: "bg-navy-blue/8 text-navy-blue/60 ring-navy-blue/6",
      },
    },
  }
);

const getStatusCopy = (
  status: CheckoutStatusKind,
  locale: Locale
): StatusCopy => {
  switch (status) {
    case "created":
      return {
        title: m.checkoutStatusCreatedTitle({}, { locale }),
        lead: m.checkoutStatusCreatedLead({}, { locale }),
        tone: "pending",
        Icon: Clock3,
      };
    case "pending":
      return {
        title: m.checkoutStatusPendingTitle({}, { locale }),
        lead: m.checkoutStatusPendingLead({}, { locale }),
        tone: "pending",
        Icon: Clock3,
      };
    case "paid_waiting_fulfillment":
      return {
        title: m.checkoutStatusPaidWaitingFulfillmentTitle({}, { locale }),
        lead: m.checkoutStatusPaidWaitingFulfillmentLead({}, { locale }),
        tone: "pending",
        Icon: MailCheck,
      };
    case "fulfilled":
      return {
        title: m.checkoutStatusFulfilledTitle({}, { locale }),
        lead: m.checkoutStatusFulfilledLead({}, { locale }),
        tone: "success",
        Icon: CheckCircle2,
      };
    case "fulfillment_failed":
      return {
        title: m.checkoutStatusFulfillmentFailedTitle({}, { locale }),
        lead: m.checkoutStatusFulfillmentFailedLead({}, { locale }),
        tone: "warning",
        Icon: AlertTriangle,
      };
    case "payment_failed":
      return {
        title: m.checkoutStatusPaymentFailedTitle({}, { locale }),
        lead: m.checkoutStatusPaymentFailedLead({}, { locale }),
        tone: "failed",
        Icon: XCircle,
      };
    case "cancelled":
      return {
        title: m.checkoutStatusCancelledTitle({}, { locale }),
        lead: m.checkoutStatusCancelledLead({}, { locale }),
        tone: "warning",
        Icon: XCircle,
      };
    case "expired":
      return {
        title: m.checkoutStatusExpiredTitle({}, { locale }),
        lead: m.checkoutStatusExpiredLead({}, { locale }),
        tone: "warning",
        Icon: Clock3,
      };
    case "not_found":
      return {
        title: m.checkoutStatusNotFoundTitle({}, { locale }),
        lead: m.checkoutStatusNotFoundLead({}, { locale }),
        tone: "unknown",
        Icon: HelpCircle,
      };
  }
};

const getSummaryRows = (
  status: CheckoutStatusViewModel,
  locale: Locale
): SummaryRow[] => {
  const { summary } = status;
  if (!summary) {
    return [];
  }

  const rows: Array<SummaryRow | undefined> = [
    {
      label: String(m.checkoutStatusSummaryTierLabel({}, { locale })),
      value: getWorkspaceProductTierTitle(summary.tier, locale),
    },
    {
      label: String(m.checkoutStatusSummaryDateLabel({}, { locale })),
      value: formatReservationDisplayDate(summary.date, locale),
    },
    summary.coffee
      ? {
          label: String(m.checkoutStatusSummaryCoffeeLabel({}, { locale })),
          value: summary.coffee
            ? m.checkoutStatusYes({}, { locale })
            : m.checkoutStatusNo({}, { locale }),
        }
      : undefined,
    summary.monitorOption
      ? {
          label: String(m.checkoutStatusSummaryMonitorLabel({}, { locale })),
          value: getWorkspaceProductMonitorTitle(summary.monitorOption, locale),
        }
      : undefined,
    {
      label: String(m.checkoutStatusSummaryPriceLabel({}, { locale })),
      value: formatWorkspaceMoney(summary.price, locale),
    },
  ];

  return rows.filter(Boolean);
};

const getFulfillmentFailedContactMessage = (
  status: CheckoutStatusViewModel,
  locale: Locale
) => {
  const tier = status.summary
    ? getWorkspaceProductTierTitle(status.summary.tier, locale)
    : m.checkoutStatusMissingSummary({}, { locale });
  const date = status.summary
    ? formatReservationDisplayDate(status.summary.date, locale)
    : m.checkoutStatusMissingSummary({}, { locale });

  return m.checkoutStatusFulfillmentFailedContactMessage(
    { orderId: status.orderId, tier, date },
    { locale }
  );
};

const getFulfillmentFailedContactHref = (
  status: CheckoutStatusViewModel,
  locale: Locale
) => {
  if (status.status !== "fulfillment_failed") return undefined;

  const url = new URL(`/${locale}/contact`, "https://deskohub.local");
  const prefill = status.supportContactPrefill;
  if (prefill?.name) url.searchParams.set("name", prefill.name);
  if (prefill?.email) url.searchParams.set("email", prefill.email);
  if (prefill?.phone) url.searchParams.set("phone", prefill.phone);
  url.searchParams.set(
    "message",
    getFulfillmentFailedContactMessage(status, locale)
  );

  return `${url.pathname}${url.search}`;
};

export function CheckoutStatusPage({
  locale,
  status,
}: CheckoutStatusPageProps) {
  const copy = getStatusCopy(status.status, locale);
  const showReservationDetails = status.status !== "not_found";
  const summaryRows = getSummaryRows(status, locale);
  const supportContactHref = getFulfillmentFailedContactHref(status, locale);
  const showSupportButton = !!supportContactHref;
  const Icon = copy.Icon;

  return (
    <CheckoutFlowLayout activeStepKey="access" locale={locale}>
      <div className="rounded-[2.25rem] border border-white/55 bg-white/94 p-6 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className={statusIconWrapperVariants({ tone: copy.tone })}>
            <Icon className="h-9 w-9" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-burned-orange">
              {m.checkoutStatusEyebrow({}, { locale })}
            </p>
            <h1 className="mt-4 text-balance text-4xl leading-none sm:text-5xl">
              {copy.title}
            </h1>
            <p
              className={cn(
                "mt-5 text-lg leading-8 text-navy-blue/70",
                showSupportButton &&
                  "after:content-['_↴'] after:text-4xl after:leading-0"
              )}
            >
              {copy.lead}
            </p>
          </div>
        </div>

        {showSupportButton && (
          <Button asChild className="h-12 px-6 mt-6 w-full">
            <Link href={supportContactHref}>
              {m.checkoutStatusFulfillmentFailedContactButton({}, { locale })}
            </Link>
          </Button>
        )}

        {showReservationDetails && (
          <div className="mt-10 rounded-[1.6rem] border border-navy-blue/10 bg-linear-to-br from-white to-aquamarine-green/8 p-5 sm:p-6">
            <h2 className="text-xl text-navy-blue">
              {m.checkoutStatusSummaryTitle({}, { locale })}
            </h2>

            <dl className="mt-5 grid gap-3">
              <div className="grid gap-1 rounded-2xl border border-navy-blue/8 bg-white/80 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/52">
                  {m.checkoutStatusOrderIdLabel({}, { locale })}
                </dt>
                <dd className="break-all font-mono text-sm font-semibold text-navy-blue">
                  {status.orderId}
                </dd>
              </div>
              {summaryRows.map((row) => (
                <div
                  key={row.label}
                  className="grid gap-1 rounded-2xl border border-navy-blue/8 bg-white/80 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"
                >
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/52">
                    {row.label}
                  </dt>
                  <dd className="text-base font-semibold text-navy-blue">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>

            {summaryRows.length === 0 && (
              <p className="mt-4 rounded-2xl border border-burned-orange/16 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue/70">
                {m.checkoutStatusMissingSummary({}, { locale })}
              </p>
            )}
          </div>
        )}

        {showReservationDetails && status.tableMap && (
          <div className="mt-8 rounded-[1.6rem] border border-navy-blue/10 bg-white/88 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl text-navy-blue">
                  {m.checkoutStatusTableMapTitle({}, { locale })}
                </h2>
                <p className="mt-2 text-sm leading-6 text-navy-blue/64">
                  {m.checkoutStatusTableMapLead({}, { locale })}
                </p>
              </div>
              {status.tableMap.roomName && (
                <p className="rounded-full border border-navy-blue/10 bg-navy-blue/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-navy-blue/60">
                  {m.checkoutStatusTableMapRoomLabel({}, { locale })}:{" "}
                  {status.tableMap.roomName}
                </p>
              )}
            </div>

            <div className="mt-5 overflow-hidden rounded-[1.2rem] border border-navy-blue/8 bg-linear-to-br from-aquamarine-green/8 to-white p-3 [&>svg]:h-[min(58vh,28rem)] [&>svg]:min-h-72 [&>svg]:w-full [&_text]:font-bold">
              <WorkspaceTableMapView
                ariaLabel={m.checkoutStatusTableMapTitle({}, { locale })}
                tableMap={status.tableMap}
              />
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild className="h-12 px-6">
            <Link href={`/${locale}/checkout/order`}>
              {m.checkoutStatusReserveAgain({}, { locale })}
            </Link>
          </Button>
          <Button asChild variant="secondary" className="h-12 px-6">
            <Link href={`/${locale}`}>
              {m.checkoutStatusBackHome({}, { locale })}
            </Link>
          </Button>
        </div>
      </div>
    </CheckoutFlowLayout>
  );
}
