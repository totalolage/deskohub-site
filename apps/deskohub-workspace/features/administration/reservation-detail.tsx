import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { formatMoney } from "@/shared/money/money";
import { AdministrationLink as Link } from "./admin-link";
import type { AdministrationReservationDetail as ReservationDetailData } from "./administration.service";
import { administrationHref } from "./administration-href";
import {
  formatAdministrationPlainDate,
  formatAdministrationReservationDate,
  getBookingTableLabel,
  PaymentAmount,
  PaymentAttemptList,
  PaymentRefundRequiredLabel,
  PaymentStatusText,
  RelatedReservationLink,
  ReservationReferences,
  ReservationTimeline,
} from "./components";
import { getAdministrationCustomerName } from "./customer-presentation";
import {
  AdministrationDetailSection,
  AdministrationFact,
} from "./detail-components";
import { EmptyState } from "./empty-state";
import { formatAdministrationDateTime } from "./formatters";
import { m } from "./i18n";
import { AdministrationDetailLoading } from "./loading";
import { NexiOrderLink } from "./nexi-order-link";
import { AdministrationAlert } from "./notice";
import { loadAdministrationReservation } from "./page-data.server";
import { AdministrationPage } from "./page-frame";
import { ReservationOrderList } from "./payment-components";
import { ReservationAccessAdministration } from "./reservation-access-administration";
import { ReservationCancellation } from "./reservation-cancellation";
import { ReservationLifecycleMap } from "./reservation-lifecycle-map";
import { getAdministrationReservationProductTitle } from "./reservation-product";

/**
 * The reservation detail screen. It awaits only the route locale, which
 * prerendering knows, and streams the reservation inside its own boundary.
 */
export async function AdministrationReservationDetail({
  params,
}: {
  readonly params: Promise<{ readonly reservationId: string }>;
}) {
  const locale = await getRequestLocale();
  return (
    <AdministrationPage>
      <Suspense
        fallback={
          <AdministrationDetailLoading
            label={m.administrationReservationDetailLoading({}, { locale })}
          />
        }
      >
        <ReservationDetailContent locale={locale} params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

async function ReservationDetailContent({
  locale,
  params,
}: {
  readonly locale: Locale;
  readonly params: Promise<{ readonly reservationId: string }>;
}) {
  const { reservationId } = await params;
  const detail = await loadAdministrationReservation(reservationId);
  const { booking, reservation } = detail;
  const unavailable = m.administrationReservationUnavailable({}, { locale });
  return (
    <>
      <h1 className="sr-only">
        {getAdministrationReservationProductTitle(reservation.product, locale)}
      </h1>

      {detail.operatorNotice && (
        <ReservationOperatorNotice
          locale={locale}
          notice={detail.operatorNotice}
        />
      )}

      <section aria-labelledby="lifecycle-heading">
        <h2 className="sr-only" id="lifecycle-heading">
          {m.administrationReservationLifecycleHeading({}, { locale })}
        </h2>
        <ReservationLifecycleMap lifecycle={detail.lifecycle} locale={locale} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl">
                  {m.administrationReservationDetailHeading({}, { locale })}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {booking && (
                  <span className="rounded-full border border-navy-blue/12 bg-navy-blue/5 px-2.5 py-1 text-xs font-semibold text-navy-blue/65">
                    {{
                      NEW: m.administrationReservationDotyposStatusNew,
                      CONFIRMED:
                        m.administrationReservationDotyposStatusConfirmed,
                      CANCELLED:
                        m.administrationReservationDotyposStatusCancelled,
                    }[booking.status]({}, { locale })}
                  </span>
                )}
                <ReservationCancellation
                  accessGrantUpdatedAt={detail.accessGrant?.updatedAt ?? null}
                  canCancel={detail.canCancel}
                  requiresProviderCredentialRemoval={
                    detail.requiresProviderCredentialRemoval
                  }
                  reservationId={reservation.id}
                />
              </div>
            </div>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {reservation.type === "cowork" ? (
                <AdministrationFact
                  label={m.administrationReservationDetailDate({}, { locale })}
                  value={
                    formatAdministrationReservationDate(reservation, locale) ??
                    unavailable
                  }
                />
              ) : (
                <>
                  <AdministrationFact
                    label={m.administrationReservationDetailStarts(
                      {},
                      { locale }
                    )}
                    value={
                      reservation.startsAt
                        ? formatAdministrationDateTime(
                            reservation.startsAt,
                            locale
                          )
                        : unavailable
                    }
                  />
                  {reservation.setupStartsAt && (
                    <AdministrationFact
                      label={m.administrationReservationDetailEarlySetup(
                        {},
                        { locale }
                      )}
                      value={formatAdministrationDateTime(
                        reservation.setupStartsAt,
                        locale
                      )}
                    />
                  )}
                  <AdministrationFact
                    label={m.administrationReservationDetailEnds(
                      {},
                      { locale }
                    )}
                    value={
                      reservation.endsAt
                        ? formatAdministrationDateTime(
                            reservation.endsAt,
                            locale
                          )
                        : unavailable
                    }
                  />
                </>
              )}
              <AdministrationFact
                label={m.administrationReservationDetailProduct({}, { locale })}
                value={getAdministrationReservationProductTitle(
                  reservation.product,
                  locale
                )}
              />
              <AdministrationFact
                label={m.administrationReservationDetailTable({}, { locale })}
                value={getBookingTableLabel(booking, locale)}
              />
              <AdministrationFact
                label={m.administrationReservationDetailGuests({}, { locale })}
                value={booking?.seats ?? unavailable}
              />
              <AdministrationFact
                label={m.administrationReservationDetailCreated({}, { locale })}
                value={formatAdministrationDateTime(
                  reservation.createdAt,
                  locale
                )}
              />
            </dl>
          </section>

          <ReservationAccessAdministration
            grant={detail.accessGrant}
            reservationId={reservation.id}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <AdministrationDetailSection
              title={m.administrationReservationDetailCustomer({}, { locale })}
            >
              {reservation.customer ? (
                <Link
                  className="font-semibold underline decoration-navy-blue/20 underline-offset-4"
                  href={administrationHref(
                    "/[locale]/admin/customers/[customerId]",
                    { customerId: reservation.customerId }
                  )}
                >
                  {getAdministrationCustomerName(reservation.customer, locale)}
                </Link>
              ) : (
                <p className="font-medium">
                  {m.administrationReservationCustomerDetailsUnavailable(
                    {},
                    { locale }
                  )}
                </p>
              )}
              <p className="mt-1 text-sm text-navy-blue/60">
                {reservation.customer?.email ??
                  reservation.customer?.phone ??
                  m.administrationReservationNoContactDetails({}, { locale })}
              </p>
              {detail.author && (
                <ReservationAuthorFact author={detail.author} locale={locale} />
              )}
            </AdministrationDetailSection>

            <AdministrationDetailSection
              title={m.administrationReservationDetailPayment({}, { locale })}
            >
              {reservation.latestPayment ? (
                <>
                  <p className="font-semibold">
                    <PaymentAmount
                      locale={locale}
                      payment={reservation.latestPayment}
                    />
                  </p>
                  <p className="mt-1 text-sm text-navy-blue/60">
                    <PaymentStatusText
                      locale={locale}
                      payment={reservation.latestPayment}
                    />
                  </p>
                  <PaymentRefundRequiredLabel
                    className="mt-2 text-sm"
                    locale={locale}
                    payment={reservation.latestPayment}
                  />
                  {reservation.latestPayment.providerOrderId && (
                    <NexiOrderLink
                      accessibleLabel={m.administrationReservationPaymentLinkLabel(
                        { orderId: reservation.latestPayment.providerOrderId },
                        { locale }
                      )}
                      className="mt-2 block break-all font-mono text-xs font-semibold text-burned-orange-ink underline underline-offset-4"
                      locale={locale}
                      orderId={reservation.latestPayment.providerOrderId}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-navy-blue/60">
                  {m.administrationReservationDetailNoPayment({}, { locale })}
                </p>
              )}
            </AdministrationDetailSection>

            <AdministrationDetailSection
              title={m.administrationReservationDetailDiscounts({}, { locale })}
            >
              {detail.discounts.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {detail.discounts.map((discount) => (
                    <li
                      className="flex justify-between gap-3"
                      key={discount.id}
                    >
                      <span>{discount.label}</span>
                      <span className="font-semibold">
                        −{formatMoney(discount.amount, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-navy-blue/60">
                  {m.administrationReservationDetailNoDiscount({}, { locale })}
                </p>
              )}
            </AdministrationDetailSection>
          </div>

          <section aria-labelledby="payment-records-heading">
            <div className="mb-3">
              <h2 className="text-xl" id="payment-records-heading">
                {m.administrationReservationDetailPaymentRecords(
                  {},
                  { locale }
                )}
              </h2>
            </div>
            {detail.paymentAttempts.length > 0 && (
              <div className="mb-4 rounded-xl border border-navy-blue/10 bg-white p-5">
                <h3 className="text-sm font-semibold">
                  {m.administrationReservationDetailLocalAttempts(
                    {},
                    { locale }
                  )}
                </h3>
                <PaymentAttemptList
                  attempts={detail.paymentAttempts}
                  locale={locale}
                />
              </div>
            )}
            <ReservationOrderList orders={detail.orders} locale={locale} />
          </section>

          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <div className="mb-6">
              <h2 className="text-xl">
                {m.administrationReservationDetailHistory({}, { locale })}
              </h2>
            </div>
            <ReservationTimeline items={detail.timeline} locale={locale} />
          </section>

          <details className="rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              {m.administrationReservationDetailReferences({}, { locale })}
            </summary>
            <ReservationReferences
              locale={locale}
              references={detail.references}
            />
          </details>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <AdministrationDetailSection
            density="compact"
            title={m.administrationReservationDetailOtherReservations(
              {},
              { locale }
            )}
          >
            {detail.otherCustomerReservations.length > 0 ? (
              detail.otherCustomerReservations.map((related) => (
                <RelatedReservationLink
                  key={related.id}
                  locale={locale}
                  reservation={related}
                />
              ))
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                {m.administrationReservationDetailNoOtherReservations(
                  {},
                  { locale }
                )}
              </p>
            )}
          </AdministrationDetailSection>
          {reservation.date && (
            <AdministrationDetailSection
              density="compact"
              title={m.administrationReservationDetailSameDate(
                {
                  date: formatAdministrationPlainDate(reservation.date, locale),
                },
                { locale }
              )}
            >
              {detail.sameDateReservations.length > 0 ? (
                detail.sameDateReservations.map((related) => (
                  <RelatedReservationLink
                    key={related.id}
                    locale={locale}
                    reservation={related}
                  />
                ))
              ) : (
                <EmptyState
                  message={m.administrationReservationDetailSameDateEmpty(
                    {},
                    { locale }
                  )}
                />
              )}
              <Link
                className="mt-2 block px-3 py-2 text-sm font-semibold hover:underline"
                href={`${administrationHref(
                  "/[locale]/admin/reservations"
                )}?date=${reservation.date}`}
              >
                {m.administrationReservationDetailSameDateViewAll(
                  {},
                  { locale }
                )}
              </Link>
            </AdministrationDetailSection>
          )}
        </aside>
      </div>
    </>
  );
}

/** The account that booked the reservation for this customer. */
function ReservationAuthorFact({
  author,
  locale,
}: {
  readonly author: NonNullable<ReservationDetailData["author"]>;
  readonly locale: Locale;
}) {
  return (
    <dl className="mt-4 border-t border-navy-blue/10 pt-4 text-sm">
      <AdministrationFact
        label={m.administrationReservationDetailBookedBy({}, { locale })}
        value={
          author.kind === "account" ? (
            <>
              {author.customerId ? (
                <Link
                  className="font-semibold underline decoration-navy-blue/20 underline-offset-4"
                  href={administrationHref(
                    "/[locale]/admin/customers/[customerId]",
                    { customerId: author.customerId }
                  )}
                >
                  {getAdministrationCustomerName(author, locale)}
                </Link>
              ) : (
                <span className="font-semibold">
                  {getAdministrationCustomerName(author, locale)}
                </span>
              )}
              <span className="mt-1 block break-all font-normal text-navy-blue/60">
                {author.email}
              </span>
            </>
          ) : (
            {
              deleted: m.administrationReservationAuthorDeleted,
              unavailable: m.administrationReservationAuthorUnavailable,
            }[author.kind]({}, { locale })
          )
        }
      />
    </dl>
  );
}

function ReservationOperatorNotice({
  locale,
  notice,
}: {
  readonly locale: Locale;
  readonly notice: NonNullable<ReservationDetailData["operatorNotice"]>;
}) {
  const { title, message } = {
    late_payment_recovery_in_progress: {
      title: m.administrationReservationLifecycleLatePaymentRecoveryInProgress,
      message: m.administrationReservationNoticeRecoveryInProgress,
    },
    late_payment_recovered: {
      title: m.administrationReservationTimelineRecoveredTitle,
      message: m.administrationReservationNoticeRecovered,
    },
    late_payment_recovery_review_required: {
      title: m.administrationReservationLifecycleLatePaymentRecoveryReview,
      message: m.administrationReservationNoticeRecoveryReview,
    },
    late_payment_refunded: {
      title: m.administrationReservationLifecycleLatePaymentRefunded,
      message: m.administrationReservationNoticeLatePaymentRefunded,
    },
    late_payment_refund_required: {
      title: m.administrationReservationLifecycleLatePaymentRefundRequired,
      message: m.administrationReservationNoticeLatePaymentRefundRequired,
    },
    payment_review: {
      title: m.administrationReservationLifecyclePaymentNeedsReview,
      message: m.administrationReservationNoticePaymentReview,
    },
  }[notice.kind];
  return (
    <AdministrationAlert
      className="mb-5"
      role={notice.status === "error" ? "alert" : "status"}
      status={notice.status}
    >
      <p className="font-semibold">{title({}, { locale })}</p>
      <p>{message({}, { locale })}</p>
    </AdministrationAlert>
  );
}
