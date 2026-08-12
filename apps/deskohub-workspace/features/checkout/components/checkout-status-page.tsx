import { cva } from "class-variance-authority";
import { Match } from "effect";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HelpCircle,
  KeyRound,
  MailCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import type {
  CheckoutStatusKind,
  CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout";
import type { CheckoutStatusSummaryPresentation } from "@/features/checkout/checkout-status-summary-presentation";
import { getCoworkCheckoutStatusSummary } from "@/features/cowork/components/cowork-checkout-status-summary";
import { type Locale, m } from "@/features/i18n";
import { getMeetingRoomCheckoutStatusSummary } from "@/features/meeting-room/components/meeting-room-checkout-status-summary";
import { getOfficeCheckoutStatusSummary } from "@/features/office/components/office-checkout-status-summary";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateTime,
} from "@/features/reservation/reservation-date";
import {
  getCoworkReservationPath,
  getReservationStartPath,
} from "@/features/reservation/routes";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import { CheckoutFlowLayout } from "./checkout-flow-layout";
import { WorkspaceTableMapView } from "./workspace-table-map-view";

type CheckoutStatusPageProps = {
  readonly locale: Locale;
  readonly status: CheckoutStatusViewModel;
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
          "bg-aquamarine-green/14 text-aquamarine-ink ring-aquamarine-green/8",
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

const getSummaryPresentation = (
  status: CheckoutStatusViewModel,
  locale: Locale
): CheckoutStatusSummaryPresentation | undefined =>
  status.summary
    ? Match.value(status.summary).pipe(
        Match.discriminatorsExhaustive("kind")({
          cowork: (summary) => getCoworkCheckoutStatusSummary(summary, locale),
          "meeting-room": (summary) =>
            getMeetingRoomCheckoutStatusSummary(summary, locale),
          office: (summary) => getOfficeCheckoutStatusSummary(summary, locale),
        })
      )
    : undefined;

const getFulfillmentFailedContactMessage = (
  status: CheckoutStatusViewModel,
  locale: Locale,
  summaryPresentation: CheckoutStatusSummaryPresentation | undefined
) => {
  const reservation =
    summaryPresentation?.reservationTitle ??
    m.checkoutStatusMissingSummary({}, { locale });
  const date = status.summary
    ? formatReservationDisplayDate(status.summary.reservedFrom, locale)
    : m.checkoutStatusMissingSummary({}, { locale });

  return m.checkoutStatusFulfillmentFailedContactMessage(
    { orderId: status.orderId, reservation, date },
    { locale }
  );
};

const getReserveAgainPath = (
  status: CheckoutStatusViewModel,
  locale: Locale
) => {
  if (status.status === "not_found") return getCoworkReservationPath(locale);
  return getReservationStartPath(locale, status.kind);
};

const ReservationAccessCodeCard = ({
  locale,
  status,
}: CheckoutStatusPageProps) => {
  if (status.status === "not_found" || !status.accessCode) return null;

  const copy = Match.value(status.accessCode).pipe(
    Match.discriminatorsExhaustive("state")({
      upcoming: ({ availableAt }) => ({
        title: m.checkoutStatusAccessUpcomingTitle({}, { locale }),
        lead: m.checkoutStatusAccessUpcomingLead(
          {
            availableAt: formatReservationDisplayDateTime(availableAt, locale),
          },
          { locale }
        ),
      }),
      available: ({ code, unavailableAt }) => ({
        title: m.checkoutStatusAccessAvailableTitle({}, { locale }),
        lead: m.checkoutStatusAccessAvailableLead(
          {
            unavailableAt: formatReservationDisplayDateTime(
              unavailableAt,
              locale
            ),
          },
          { locale }
        ),
        code,
      }),
      ended: () => ({
        title: m.checkoutStatusAccessEndedTitle({}, { locale }),
        lead: m.checkoutStatusAccessEndedLead({}, { locale }),
      }),
      unavailable: () => ({
        title: m.checkoutStatusAccessUnavailableTitle({}, { locale }),
        lead: m.checkoutStatusAccessUnavailableLead({}, { locale }),
      }),
    })
  );

  return (
    <section className="mt-8 overflow-hidden rounded-[1.6rem] border border-navy-blue/12 bg-navy-blue text-white shadow-[0_20px_60px_-35px_rgba(0,2,79,0.8)]">
      <div className="flex items-start gap-4 px-5 py-5 sm:px-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-aquamarine-green/15 text-aquamarine-green">
          <KeyRound className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl text-white">{copy.title}</h2>
          <p className="mt-2 text-sm leading-6 text-white/72">{copy.lead}</p>
        </div>
      </div>
      {"code" in copy && copy.code && (
        <div className="border-t border-white/12 bg-white/6 px-5 py-6 text-center sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-aquamarine-green">
            {m.checkoutStatusAccessPinLabel({}, { locale })}
          </p>
          <output
            className="mt-2 block font-mono text-5xl font-bold tracking-[0.16em] text-white sm:text-6xl"
            data-ph-mask=""
            data-ph-no-capture=""
          >
            {copy.code}
          </output>
        </div>
      )}
    </section>
  );
};

const getFulfillmentFailedContactHref = (
  status: CheckoutStatusViewModel,
  locale: Locale,
  summaryPresentation: CheckoutStatusSummaryPresentation | undefined
) => {
  if (status.status !== "fulfillment_failed") return undefined;

  const url = new URL(`/${locale}/contact`, "https://deskohub.local");
  const prefill = status.supportContactPrefill;
  if (prefill?.name) url.searchParams.set("name", prefill.name);
  if (prefill?.email) url.searchParams.set("email", prefill.email);
  if (prefill?.phone) url.searchParams.set("phone", prefill.phone);
  url.searchParams.set(
    "message",
    getFulfillmentFailedContactMessage(status, locale, summaryPresentation)
  );

  return `${url.pathname}${url.search}`;
};

export function CheckoutStatusPage({
  locale,
  status,
}: CheckoutStatusPageProps) {
  const copy = getStatusCopy(status.status, locale);
  const showReservationDetails = status.status !== "not_found";
  const summaryPresentation = getSummaryPresentation(status, locale);
  const summaryRows = summaryPresentation?.rows ?? [];
  const supportContactHref = getFulfillmentFailedContactHref(
    status,
    locale,
    summaryPresentation
  );
  const showSupportButton = !!supportContactHref;
  const Icon = copy.Icon;

  return (
    <CheckoutFlowLayout activeStepKey="access" locale={locale}>
      <div className="rounded-[2.25rem] border border-white/55 bg-white/94 p-6 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm sm:p-10">
        <output className="sr-only" aria-live="polite" aria-atomic>
          {m.checkoutStatusEyebrow({}, { locale })}: {copy.title}
        </output>
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
            <Link
              href={supportContactHref}
              id="checkout-status-support-contact"
              prefetch={false}
            >
              {m.checkoutStatusFulfillmentFailedContactButton({}, { locale })}
            </Link>
          </Button>
        )}

        <ReservationAccessCodeCard locale={locale} status={status} />

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
              <p className="mt-4 rounded-2xl border border-burned-orange/16 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-burned-orange-ink">
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
            <a
              href={getReserveAgainPath(status, locale)}
              id="checkout-status-reserve-again"
            >
              {m.checkoutStatusReserveAgain({}, { locale })}
            </a>
          </Button>
          <Button asChild variant="secondary" className="h-12 px-6">
            <Link href={`/${locale}`} prefetch={false}>
              {m.checkoutStatusBackHome({}, { locale })}
            </Link>
          </Button>
        </div>
      </div>
    </CheckoutFlowLayout>
  );
}
