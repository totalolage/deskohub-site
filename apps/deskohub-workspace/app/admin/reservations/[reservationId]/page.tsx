import Link from "next/link";
import {
  AdministrationPage,
  EmptyState,
  formatAdministrationDateTime,
  formatAdministrationMoney,
  formatAdministrationPlainDate,
  formatAdministrationReservationDate,
  getBookingTableLabel,
  PaymentAttemptList,
  RelatedReservationLink,
  ReservationReferences,
  ReservationTimeline,
} from "@/features/administration/components";
import { loadAdministrationReservation } from "@/features/administration/page-data.server";
import { ReservationOrderList } from "@/features/administration/payment-components";
import { ReservationLifecycleMap } from "@/features/administration/reservation-lifecycle-map";

export default async function ReservationAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly reservationId: string }>;
}) {
  const { reservationId } = await params;
  const detail = await loadAdministrationReservation(reservationId);
  const { booking, reservation } = detail;
  return (
    <AdministrationPage>
      <h1 className="sr-only">{reservation.typeLabel}</h1>

      <section aria-labelledby="lifecycle-heading">
        <h2 className="sr-only" id="lifecycle-heading">
          Reservation lifecycle
        </h2>
        <ReservationLifecycleMap lifecycle={detail.lifecycle} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl">Reservation details</h2>
              </div>
              {booking && (
                <span className="rounded-full border border-navy-blue/12 bg-navy-blue/5 px-2.5 py-1 text-xs font-semibold text-navy-blue/65">
                  Dotypos {booking.statusLabel.toLowerCase()}
                </span>
              )}
            </div>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {reservation.type === "cowork" ? (
                <ReservationFact
                  label="Date"
                  value={
                    formatAdministrationReservationDate(reservation) ??
                    "Unavailable"
                  }
                />
              ) : (
                <>
                  <ReservationFact
                    label="Starts"
                    value={
                      reservation.startsAt
                        ? formatAdministrationDateTime(reservation.startsAt)
                        : "Unavailable"
                    }
                  />
                  <ReservationFact
                    label="Ends"
                    value={
                      reservation.endsAt
                        ? formatAdministrationDateTime(reservation.endsAt)
                        : "Unavailable"
                    }
                  />
                </>
              )}
              <ReservationFact label="Product" value={reservation.typeLabel} />
              <ReservationFact
                label="Table"
                value={getBookingTableLabel(booking)}
              />
              <ReservationFact
                label="Guests"
                value={booking?.seats ?? "Unavailable"}
              />
              <ReservationFact
                label="Created"
                value={formatAdministrationDateTime(reservation.createdAt)}
              />
            </dl>
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <SummarySection title="Customer">
              {reservation.customer ? (
                <Link
                  className="font-semibold underline decoration-navy-blue/20 underline-offset-4"
                  href={`/admin/customers/${reservation.customerId}`}
                >
                  {reservation.customer.displayName}
                </Link>
              ) : (
                <p className="font-medium">Details unavailable</p>
              )}
              <p className="mt-1 text-sm text-navy-blue/60">
                {reservation.customer?.email ??
                  reservation.customer?.phone ??
                  "No contact details"}
              </p>
            </SummarySection>

            <SummarySection title="Payment">
              {reservation.latestPayment ? (
                <>
                  <p className="font-semibold">
                    {formatAdministrationMoney(
                      reservation.latestPayment.amount
                    )}
                  </p>
                  <p className="mt-1 text-sm text-navy-blue/60">
                    {reservation.latestPayment.stateLabel} ·{" "}
                    {formatAdministrationDateTime(
                      reservation.latestPayment.updatedAt
                    )}
                  </p>
                  {reservation.latestPayment.providerOrderId && (
                    <a
                      aria-label={`Payment ${reservation.latestPayment.providerOrderId} (opens in XPay)`}
                      className="mt-2 block break-all font-mono text-xs font-semibold text-burned-orange-ink underline underline-offset-4"
                      href={`https://xpaydashboard.nexigroup.com/nexi/ordermanagement/order/${encodeURIComponent(reservation.latestPayment.providerOrderId)}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {reservation.latestPayment.providerOrderId} ↗
                    </a>
                  )}
                </>
              ) : (
                <p className="text-sm text-navy-blue/60">
                  No payment attempt started.
                </p>
              )}
            </SummarySection>

            <SummarySection title="Discounts">
              {detail.discounts.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {detail.discounts.map((discount) => (
                    <li
                      className="flex justify-between gap-3"
                      key={discount.id}
                    >
                      <span>{discount.label}</span>
                      <span className="font-semibold">
                        −{formatAdministrationMoney(discount.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-navy-blue/60">
                  No discount was applied.
                </p>
              )}
            </SummarySection>
          </div>

          <section aria-labelledby="payment-records-heading">
            <div className="mb-3">
              <h2 className="text-xl" id="payment-records-heading">
                Payment records
              </h2>
            </div>
            {detail.paymentAttempts.length > 0 && (
              <div className="mb-4 rounded-xl border border-navy-blue/10 bg-white p-5">
                <h3 className="text-sm font-semibold">Local attempts</h3>
                <PaymentAttemptList attempts={detail.paymentAttempts} />
              </div>
            )}
            <ReservationOrderList orders={detail.orders} />
          </section>

          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <div className="mb-6">
              <h2 className="text-xl">History</h2>
            </div>
            <ReservationTimeline items={detail.timeline} />
          </section>

          <details className="rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              References
            </summary>
            <ReservationReferences references={detail.references} />
          </details>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <RelatedSection title="Other reservations">
            {detail.otherCustomerReservations.length > 0 ? (
              detail.otherCustomerReservations.map((related) => (
                <RelatedReservationLink
                  key={related.id}
                  reservation={related}
                />
              ))
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                No other reservations.
              </p>
            )}
          </RelatedSection>
          {reservation.date && (
            <RelatedSection
              title={`Also on ${formatAdministrationPlainDate(reservation.date)}`}
            >
              {detail.sameDateReservations.length > 0 ? (
                detail.sameDateReservations.map((related) => (
                  <RelatedReservationLink
                    key={related.id}
                    reservation={related}
                  />
                ))
              ) : (
                <EmptyState message="No other reservations on this date." />
              )}
              <Link
                className="mt-2 block px-3 py-2 text-sm font-semibold hover:underline"
                href={`/admin/reservations?date=${reservation.date}`}
              >
                View all on this date →
              </Link>
            </RelatedSection>
          )}
        </aside>
      </div>
    </AdministrationPage>
  );
}

function ReservationFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-blue/65">
        {label}
      </dt>
      <dd className="mt-1.5 font-medium">{value}</dd>
    </div>
  );
}

function SummarySection({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title: string;
}) {
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-navy-blue/65">
        {title}
      </h2>
      {children}
    </section>
  );
}

function RelatedSection({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title: string;
}) {
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-3">
      <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/65">
        {title}
      </h2>
      {children}
    </section>
  );
}
