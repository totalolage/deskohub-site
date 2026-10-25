import { Suspense } from "react";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { m } from "./i18n";
import {
  AdministrationCustomerMetricsLoading,
  AdministrationMetricsLoading,
  AdministrationReservationActivityLoading,
} from "./loading";
import {
  CustomerActivity,
  OverviewReservationActivityCalendar,
  OverviewReservationActivityTotal,
  ReservationCounts,
} from "./overview-activity";
import {
  loadAdministrationOverview,
  loadAdministrationRefundAttention,
  loadAdministrationReservationActivity,
  loadAdministrationReservationOverview,
} from "./page-data.server";
import { AdministrationPage } from "./page-frame";
import { RefundAttention } from "./refund-attention";
import { ReservationLookup } from "./reservation-lookup";

/**
 * The administration landing screen. It awaits only the route locale, which
 * prerendering knows, and streams each data section through its own boundary.
 */
export async function AdministrationOverview() {
  const customerOverview = loadAdministrationOverview();
  const reservationOverview = loadAdministrationReservationOverview();
  const refundAttention = loadAdministrationRefundAttention();
  const reservationActivity = loadAdministrationReservationActivity();
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <section aria-labelledby="reservation-activity-heading" className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl" id="reservation-activity-heading">
            {m.administrationReservationActivityTitle({}, { locale })}
          </h1>
          <Suspense fallback={null}>
            <OverviewReservationActivityTotal
              activity={reservationActivity}
              locale={locale}
            />
          </Suspense>
        </div>
        <Suspense fallback={<AdministrationReservationActivityLoading />}>
          <OverviewReservationActivityCalendar
            activity={reservationActivity}
            locale={locale}
          />
        </Suspense>
      </section>
      <Suspense fallback={null}>
        <RefundAttention count={refundAttention} />
      </Suspense>
      <section
        aria-labelledby="reservation-counts-heading"
        className="@container"
      >
        <div className="mb-3">
          <h2 className="text-xl" id="reservation-counts-heading">
            {m.administrationOverviewReservationCountsTitle({}, { locale })}
          </h2>
        </div>
        <Suspense fallback={<AdministrationMetricsLoading />}>
          <ReservationCounts locale={locale} overview={reservationOverview} />
        </Suspense>
      </section>

      <section
        aria-labelledby="customer-activity-heading"
        className="@container mt-8"
      >
        <div className="mb-3">
          <h2 className="text-xl" id="customer-activity-heading">
            {m.administrationOverviewCustomerActivityTitle({}, { locale })}
          </h2>
        </div>
        <Suspense fallback={<AdministrationCustomerMetricsLoading />}>
          <CustomerActivity locale={locale} overview={customerOverview} />
        </Suspense>
      </section>

      <section aria-labelledby="find-heading" className="mt-8">
        <div className="mb-3">
          <h2 className="text-xl" id="find-heading">
            {m.administrationOverviewFindTitle({}, { locale })}
          </h2>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <ReservationLookup />
          <CustomerSearch />
        </div>
      </section>
    </AdministrationPage>
  );
}
