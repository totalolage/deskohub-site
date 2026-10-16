import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { ArrowRight } from "lucide-react";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import { AdministrationLink as Link } from "./admin-link";
import type {
  AdministrationBookingSummary,
  AdministrationPaymentAttempt,
  AdministrationReservationSummary,
  AdministrationTimelineItem,
} from "./administration.service";
import {
  formatAdministrationDateTime,
  formatAdministrationReservationDate,
} from "./formatters";
import { m } from "./i18n";
import { NexiOrderLink } from "./nexi-order-link";
import {
  PaymentAmount,
  PaymentRefundRequiredLabel,
  PaymentStatusLabel,
} from "./payment-status";

export { BookingStatusBadge, BookingTable } from "./booking-table";
export { CustomerReservationActivity } from "./customer-reservation-activity";
export { AdministrationCustomerTable } from "./customer-table";
export {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
  type AdministrationDataTableSorting,
} from "./data-table";
export {
  AdministrationDetailSection,
  AdministrationFact,
} from "./detail-components";
export { EmptyState } from "./empty-state";
export {
  formatAdministrationDateTime,
  formatAdministrationMoney,
  formatAdministrationPlainDate,
  formatAdministrationReservationDate,
} from "./formatters";
export { NexiOrderLink } from "./nexi-order-link";
export {
  AdministrationAlert,
  AdministrationNoticeBanner,
} from "./notice";
export { AdministrationPage, AdministrationPageHeader } from "./page-frame";
export {
  PaymentAmount,
  PaymentRefundRequiredLabel,
  PaymentStatusText,
} from "./payment-status";
export { ReservationTable } from "./reservation-table";
export {
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "./table-toolbar";

export const getBookingTableLabel = (
  booking: Pick<AdministrationBookingSummary, "tableId" | "tableName"> | null
) => {
  if (!booking) return "Unavailable";
  if (booking.tableName) return booking.tableName;
  return booking.tableId ? "Details unavailable" : "Not assigned";
};

export function PaymentAttemptList({
  attempts,
  locale,
}: {
  readonly attempts: readonly AdministrationPaymentAttempt[];
  readonly locale: Locale;
}) {
  return (
    <ul className="mt-4 divide-y divide-navy-blue/10">
      {attempts.map((attempt) => (
        <li
          className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
          key={attempt.id}
        >
          <div>
            <p className="font-semibold">{attempt.providerLabel}</p>
            <p className="mt-1 text-sm text-navy-blue/65">
              {formatAdministrationDateTime(attempt.createdAt, locale)}
            </p>
            {attempt.providerOrderId && (
              <div className="mt-2 text-sm font-semibold text-burned-orange-ink">
                <NexiOrderLink
                  className="flex-wrap"
                  locale={locale}
                  orderId={attempt.providerOrderId}
                >
                  <span>Nexi order</span>
                  <span className="break-all font-mono text-xs">
                    {attempt.providerOrderId}
                  </span>
                </NexiOrderLink>
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="font-semibold">
              <PaymentAmount locale={locale} payment={attempt} />
            </p>
            <p className="mt-1 text-sm text-navy-blue/65">
              <PaymentStatusLabel locale={locale} payment={attempt} />
              <PaymentRefundRequiredLabel locale={locale} payment={attempt} />
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReservationTimeline({
  items,
  locale,
}: {
  readonly items: readonly AdministrationTimelineItem[];
  readonly locale: Locale;
}) {
  return (
    <ol className="relative space-y-0" aria-label="Reservation history">
      {items.map((item, index) => (
        <li
          className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-4 pb-7 last:pb-0"
          key={item.id}
        >
          {index < items.length - 1 && (
            <span className="absolute left-[0.59rem] top-5 h-[calc(100%-0.25rem)] w-px bg-navy-blue/12" />
          )}
          <span
            className={cn(
              "relative z-10 mt-1 size-5 rounded-full border-4 border-white",
              item.tone === "positive" && "bg-aquamarine-ink",
              item.tone === "warning" && "bg-burned-orange",
              item.tone === "neutral" && "bg-navy-blue/35"
            )}
          />
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                {item.href ? (
                  <Link
                    className="underline underline-offset-4"
                    href={item.href}
                  >
                    {item.title}
                  </Link>
                ) : (
                  item.title
                )}
              </h3>
              <time
                className="text-xs text-navy-blue/65"
                dateTime={item.occurredAt}
              >
                {formatAdministrationDateTime(item.occurredAt, locale)}
              </time>
            </div>
            <p className="mt-1 text-sm leading-5 text-navy-blue/65">
              {item.description}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function RelatedReservationLink({
  locale,
  reservation,
}: {
  readonly locale: Locale;
  readonly reservation: AdministrationReservationSummary;
}) {
  return (
    <Link
      className="group flex items-center justify-between gap-3 rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
      href={`/admin/reservations/${reservation.id}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">
          {formatAdministrationReservationDate(reservation, locale) ??
            reservation.typeLabel}
        </span>
        <span className="mt-2 block text-sm font-medium">
          {reservation.customer?.displayName ?? "Customer unavailable"}
        </span>
        {reservation.customer && (
          <span className="mt-0.5 block break-all text-xs text-navy-blue/65">
            {reservation.customer.email ?? "No email address"}
          </span>
        )}
        <span
          className={cn(
            "mt-2 block text-xs",
            reservation.statusNote
              ? "font-medium text-burned-orange-ink"
              : "text-navy-blue/65"
          )}
        >
          {reservation.statusNote ?? reservation.status.label}
        </span>
        {reservation.statusNote && (
          <span className="mt-1 block text-xs text-navy-blue/65">
            Deskohub: {reservation.status.label}
          </span>
        )}
      </span>
      <ArrowRight
        aria-hidden
        className="size-4 text-navy-blue/65 group-hover:text-navy-blue"
      />
    </Link>
  );
}

export function ReservationReferences({
  references,
}: {
  readonly references: {
    readonly workspaceReservationId: WorkspaceReservationId;
    readonly dotyposReservationId: DotyposReservationId | null;
    readonly customerId: DotyposCustomerId;
  };
}) {
  return (
    <dl className="grid gap-4 border-t border-navy-blue/10 px-5 py-4 text-sm">
      <Reference
        label="Reservation record"
        value={references.workspaceReservationId}
      />
      {references.dotyposReservationId && (
        <Reference
          label="Dotypos booking"
          value={references.dotyposReservationId}
        />
      )}
      <Reference
        href={`/admin/customers/${references.customerId}`}
        label="Customer"
        value={references.customerId}
      />
    </dl>
  );
}

function Reference({
  href,
  label,
  value,
}: {
  readonly href?: string;
  readonly label: string;
  readonly value: string;
}) {
  const content = <span className="break-all font-mono text-xs">{value}</span>;
  return (
    <div>
      <dt className="text-navy-blue/65">{label}</dt>
      <dd className="mt-1">
        {href ? (
          <Link className="underline underline-offset-4" href={href}>
            {content}
          </Link>
        ) : (
          content
        )}
      </dd>
    </div>
  );
}

export function Pagination({
  basePath,
  locale,
  page,
  pageCount,
  pageParam = "page",
  params = {},
}: {
  readonly basePath: string;
  readonly locale: Locale;
  readonly page: number;
  readonly pageCount: number;
  readonly pageParam?: string;
  readonly params?: Readonly<Record<string, string | undefined>>;
}) {
  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (target > 1) search.set(pageParam, String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label={m.administrationPaginationLabel({}, { locale })}
      className="mt-5 flex items-center justify-between"
    >
      <Button
        asChild={page > 1}
        disabled={page <= 1}
        size="sm"
        variant="secondary"
      >
        {page > 1 ? (
          <Link href={href(page - 1)}>
            {m.administrationPaginationPrevious({}, { locale })}
          </Link>
        ) : (
          <span>{m.administrationPaginationPrevious({}, { locale })}</span>
        )}
      </Button>
      <span className="text-sm text-navy-blue/65">
        {m.administrationPaginationStatus({ page, pageCount }, { locale })}
      </span>
      <Button
        asChild={page < pageCount}
        disabled={page >= pageCount}
        size="sm"
        variant="secondary"
      >
        {page < pageCount ? (
          <Link href={href(page + 1)}>
            {m.administrationPaginationNext({}, { locale })}
          </Link>
        ) : (
          <span>{m.administrationPaginationNext({}, { locale })}</span>
        )}
      </Button>
    </nav>
  );
}
