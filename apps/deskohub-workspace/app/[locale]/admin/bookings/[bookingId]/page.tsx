import type { ReactNode } from "react";
import { Suspense } from "react";
import {
  AdministrationRecordLink,
  AdministrationLink as Link,
} from "@/features/administration/admin-link";
import {
  type AdministrationHref,
  administrationHref,
} from "@/features/administration/administration-href";
import {
  getAdministrationBookingGuestCount,
  getAdministrationBookingStatusLabel,
} from "@/features/administration/booking-presentation";
import {
  AdministrationDetailSection,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
  BookingStatusBadge,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { getAdministrationCustomerName } from "@/features/administration/customer-presentation";
import { m } from "@/features/administration/i18n";
import { AdministrationDetailLoading } from "@/features/administration/loading";
import { loadAdministrationBooking } from "@/features/administration/page-data.server";
import { getAdministrationReservationProductTitle } from "@/features/administration/reservation-product";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function BookingAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly bookingId: string }>;
}) {
  return <BookingAdministrationDetailScreen params={params} />;
}

async function BookingAdministrationDetailScreen({
  params,
}: {
  readonly params: Promise<{ readonly bookingId: string }>;
}) {
  const locale = await getRequestLocale();
  return (
    <AdministrationPage>
      <Suspense
        fallback={
          <AdministrationDetailLoading
            label={m.administrationBookingDetailLoading({}, { locale })}
          />
        }
      >
        <BookingAdministrationDetail locale={locale} params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

export async function BookingAdministrationDetail({
  locale,
  params,
}: {
  readonly locale: Locale;
  readonly params: Promise<{ readonly bookingId: string }>;
}) {
  const { bookingId } = await params;
  const { booking, references } = await loadAdministrationBooking(bookingId);
  return (
    <>
      <AdministrationPageHeader
        actions={<BookingStatusBadge booking={booking} locale={locale} />}
        description={m.administrationBookingDetailDescription(
          {
            guests: getAdministrationBookingGuestCount(booking.seats, locale),
            startsAt: formatAdministrationDateTime(booking.startsAt, locale),
          },
          { locale }
        )}
        eyebrow={m.administrationBookingDetailEyebrow({}, { locale })}
        title={
          booking.tableName ??
          m.administrationBookingDetailUnassignedTitle({}, { locale })
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">
              {m.administrationBookingDetailTitle({}, { locale })}
            </h2>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <AdministrationFact
                label={m.administrationBookingFactStatus({}, { locale })}
                value={getAdministrationBookingStatusLabel(
                  booking.status,
                  locale
                )}
              />
              <AdministrationFact
                label={m.administrationBookingFactStarts({}, { locale })}
                value={formatAdministrationDateTime(booking.startsAt, locale)}
              />
              <AdministrationFact
                label={m.administrationBookingFactEnds({}, { locale })}
                value={formatAdministrationDateTime(booking.endsAt, locale)}
              />
              <AdministrationFact
                label={m.administrationBookingFactGuests({}, { locale })}
                value={booking.seats}
              />
              <AdministrationFact
                label={m.administrationBookingFactTable({}, { locale })}
                value={
                  booking.tableName ??
                  m.administrationBookingTableNotAssigned({}, { locale })
                }
              />
              <AdministrationFact
                label={m.administrationBookingFactLocation({}, { locale })}
                value={
                  booking.tableLocation ??
                  m.administrationBookingLocationNotSpecified({}, { locale })
                }
              />
              {booking.createdAt && (
                <AdministrationFact
                  label={m.administrationBookingFactCreated({}, { locale })}
                  value={formatAdministrationDateTime(
                    booking.createdAt,
                    locale
                  )}
                />
              )}
              {booking.updatedAt && (
                <AdministrationFact
                  label={m.administrationBookingFactLastChanged({}, { locale })}
                  value={formatAdministrationDateTime(
                    booking.updatedAt,
                    locale
                  )}
                />
              )}
            </dl>
          </section>

          <details className="rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              {m.administrationBookingReferencesTitle({}, { locale })}
            </summary>
            <dl className="grid gap-4 border-t border-navy-blue/10 px-5 py-4 text-sm">
              <BookingReference
                label={m.administrationBookingReferenceBooking({}, { locale })}
                value={references.bookingId}
              />
              {references.customerId && (
                <BookingReference
                  href={administrationHref(
                    "/[locale]/admin/customers/[customerId]",
                    { customerId: references.customerId }
                  )}
                  label={m.administrationBookingReferenceCustomer(
                    {},
                    { locale }
                  )}
                  value={references.customerId}
                />
              )}
              {references.workspaceReservationId && (
                <BookingReference
                  href={administrationHref(
                    "/[locale]/admin/reservations/[reservationId]",
                    { reservationId: references.workspaceReservationId }
                  )}
                  label={m.administrationBookingReferenceReservation(
                    {},
                    { locale }
                  )}
                  value={references.workspaceReservationId}
                />
              )}
            </dl>
          </details>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <RelatedBookingEntity
            title={m.administrationBookingRelatedCustomer({}, { locale })}
          >
            {booking.customer && booking.customerId ? (
              <AdministrationRecordLink
                href={administrationHref(
                  "/[locale]/admin/customers/[customerId]",
                  { customerId: booking.customerId }
                )}
              >
                <span className="block font-semibold">
                  {getAdministrationCustomerName(booking.customer, locale)}
                </span>
                <span className="mt-1 block text-sm text-navy-blue/65">
                  {booking.customer.email ??
                    booking.customer.phone ??
                    m.administrationBookingViewCustomer({}, { locale })}
                </span>
              </AdministrationRecordLink>
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                {m.administrationBookingCustomerDetailsMissing({}, { locale })}
              </p>
            )}
          </RelatedBookingEntity>

          <RelatedBookingEntity
            title={m.administrationBookingRelatedReservation({}, { locale })}
          >
            {booking.linkedReservation ? (
              <AdministrationRecordLink
                href={administrationHref(
                  "/[locale]/admin/reservations/[reservationId]",
                  { reservationId: booking.linkedReservation.id }
                )}
              >
                <span className="block font-semibold">
                  {getAdministrationReservationProductTitle(
                    booking.linkedReservation.product,
                    locale
                  )}
                </span>
                <span className="mt-1 block text-sm text-navy-blue/65">
                  {m.administrationBookingViewReservationHistory(
                    {},
                    { locale }
                  )}
                </span>
              </AdministrationRecordLink>
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                {m.administrationBookingNoLinkedReservation({}, { locale })}
              </p>
            )}
          </RelatedBookingEntity>
        </aside>
      </div>
    </>
  );
}

function BookingReference({
  href,
  label,
  value,
}: {
  readonly href?: AdministrationHref;
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
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <AdministrationDetailSection density="compact" title={title}>
      {children}
    </AdministrationDetailSection>
  );
}
