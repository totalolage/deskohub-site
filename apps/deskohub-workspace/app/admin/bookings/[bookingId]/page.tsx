import Link from "next/link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  BookingStatusBadge,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { loadAdministrationBooking } from "@/features/administration/page-data.server";

export default async function BookingAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly bookingId: string }>;
}) {
  const { bookingId } = await params;
  const { booking, references } = await loadAdministrationBooking(bookingId);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={<BookingStatusBadge booking={booking} />}
        description={`${formatAdministrationDateTime(booking.startsAt)} · ${booking.seats} ${booking.seats === "1" ? "guest" : "guests"}`}
        eyebrow="Dotypos booking"
        title={booking.tableName ?? "Unassigned booking"}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">Booking details</h2>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <BookingFact label="Status" value={booking.statusLabel} />
              <BookingFact
                label="Starts"
                value={formatAdministrationDateTime(booking.startsAt)}
              />
              <BookingFact
                label="Ends"
                value={formatAdministrationDateTime(booking.endsAt)}
              />
              <BookingFact label="Guests" value={booking.seats} />
              <BookingFact
                label="Table"
                value={booking.tableName ?? "Not assigned"}
              />
              <BookingFact
                label="Location"
                value={booking.tableLocation ?? "Not specified"}
              />
              {booking.createdAt && (
                <BookingFact
                  label="Created"
                  value={formatAdministrationDateTime(booking.createdAt)}
                />
              )}
              {booking.updatedAt && (
                <BookingFact
                  label="Last changed"
                  value={formatAdministrationDateTime(booking.updatedAt)}
                />
              )}
            </dl>
          </section>

          <details className="rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              References
            </summary>
            <dl className="grid gap-4 border-t border-navy-blue/10 px-5 py-4 text-sm">
              <BookingReference
                label="Booking record"
                value={references.bookingId}
              />
              {references.customerId && (
                <BookingReference
                  href={`/admin/customers/${references.customerId}`}
                  label="Customer"
                  value={references.customerId}
                />
              )}
              {references.workspaceReservationId && (
                <BookingReference
                  href={`/admin/reservations/${references.workspaceReservationId}`}
                  label="Reservation"
                  value={references.workspaceReservationId}
                />
              )}
            </dl>
          </details>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <RelatedBookingEntity title="Customer">
            {booking.customer && booking.customerId ? (
              <Link
                className="block rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
                href={`/admin/customers/${booking.customerId}`}
              >
                <span className="block font-semibold">
                  {booking.customer.displayName}
                </span>
                <span className="mt-1 block text-sm text-navy-blue/65">
                  {booking.customer.email ??
                    booking.customer.phone ??
                    "View customer"}
                </span>
              </Link>
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                Customer details unavailable.
              </p>
            )}
          </RelatedBookingEntity>

          <RelatedBookingEntity title="Workspace reservation">
            {booking.linkedReservation ? (
              <Link
                className="block rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
                href={`/admin/reservations/${booking.linkedReservation.id}`}
              >
                <span className="block font-semibold">
                  {booking.linkedReservation.label}
                </span>
                <span className="mt-1 block text-sm text-navy-blue/65">
                  View lifecycle and payment history
                </span>
              </Link>
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                No Workspace reservation is linked.
              </p>
            )}
          </RelatedBookingEntity>
        </aside>
      </div>
    </AdministrationPage>
  );
}

function BookingFact({
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

function BookingReference({
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

function RelatedBookingEntity({
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
