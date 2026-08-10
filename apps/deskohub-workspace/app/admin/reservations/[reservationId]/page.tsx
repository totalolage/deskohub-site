import Link from "next/link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  EmptyState,
  formatAdministrationDate,
  formatAdministrationDateTime,
  formatAdministrationMoney,
  PaymentAttemptList,
  RelatedReservationLink,
  ReservationReferences,
  ReservationStatusBadge,
  ReservationTimeline,
} from "@/features/administration/components";
import { loadAdministrationReservation } from "@/features/administration/page-data.server";

export default async function ReservationAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly reservationId: string }>;
}) {
  const { reservationId } = await params;
  const detail = await loadAdministrationReservation(reservationId);
  const { reservation } = detail;
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={<ReservationStatusBadge status={reservation.status} />}
        description={
          reservation.startsAt
            ? `${reservation.typeLabel} · ${formatAdministrationDateTime(reservation.startsAt)}`
            : `${reservation.typeLabel} · Booking details unavailable`
        }
        eyebrow="Reservation"
        title={reservation.customer?.displayName ?? reservation.typeLabel}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">Current reservation</h2>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <ReservationFact
                label="Status"
                value={reservation.status.label}
              />
              <ReservationFact
                label="Reservation"
                value={reservation.typeLabel}
              />
              <ReservationFact
                label="Starts"
                value={
                  reservation.startsAt
                    ? formatAdministrationDateTime(reservation.startsAt)
                    : "Booking details unavailable"
                }
              />
              <ReservationFact
                label="Ends"
                value={
                  reservation.endsAt
                    ? formatAdministrationDateTime(reservation.endsAt)
                    : "Booking details unavailable"
                }
              />
              <ReservationFact
                label="Customer"
                value={
                  reservation.customer?.displayName ??
                  "Customer details unavailable"
                }
              />
              <ReservationFact
                label="Last changed"
                value={formatAdministrationDateTime(reservation.updatedAt)}
              />
            </dl>
          </section>

          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <div className="mb-6">
              <h2 className="text-xl">History</h2>
              <p className="mt-1 text-sm text-navy-blue/65">
                A chronological view of confirmed milestones and available
                activity.
              </p>
            </div>
            <ReservationTimeline items={detail.timeline} />
          </section>

          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">Payments and orders</h2>
            {detail.paymentAttempts.length === 0 ? (
              <p className="mt-4 text-sm text-navy-blue/65">
                No payment attempt has started.
              </p>
            ) : (
              <PaymentAttemptList attempts={detail.paymentAttempts} />
            )}
            {detail.orders.some(
              ({ providerStatus }) => providerStatus === "not_found"
            ) && (
              <p className="mt-4 rounded-lg border border-burned-orange/30 bg-burned-orange/10 px-3 py-2 text-sm">
                Nexi did not find at least one locally referenced order. Follow
                its order link to investigate the mismatch.
              </p>
            )}
            {detail.orders.some(
              ({ providerStatus }) => providerStatus === "unavailable"
            ) && (
              <p className="mt-4 rounded-lg border border-sunset-yellow/35 bg-sunset-yellow/10 px-3 py-2 text-sm">
                Some live Nexi order details are temporarily unavailable. The
                local order links remain available.
              </p>
            )}
            {detail.discounts.length > 0 && (
              <div className="mt-5 border-t border-navy-blue/10 pt-5">
                <h3 className="text-sm font-semibold">Applied discounts</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {detail.discounts.map((discount) => (
                    <li
                      className="flex justify-between gap-4"
                      key={discount.id}
                    >
                      <span>{discount.label}</span>
                      <span className="font-semibold">
                        −{formatAdministrationMoney(discount.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <details className="rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              References
            </summary>
            <ReservationReferences references={detail.references} />
          </details>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <RelatedSection title="Customer">
            {reservation.customer ? (
              <Link
                className="block rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
                href={`/admin/customers/${reservation.customerId}`}
              >
                <span className="block font-semibold">
                  {reservation.customer.displayName}
                </span>
                <span className="mt-1 block text-sm text-navy-blue/65">
                  {reservation.customer.email ??
                    reservation.customer.phone ??
                    "View customer"}
                </span>
              </Link>
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                Customer details unavailable.
              </p>
            )}
          </RelatedSection>
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
              title={`Reservations on ${formatAdministrationDate(reservation.date)}`}
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
