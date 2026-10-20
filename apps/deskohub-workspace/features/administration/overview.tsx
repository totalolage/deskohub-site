import { Suspense } from "react";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { m } from "./i18n";
import {
  AdministrationCustomerMetricsLoading,
  AdministrationMetricsLoading,
} from "./loading";
import { CustomerActivity, ReservationActivity } from "./overview-activity";
import {
  loadAdministrationOverview,
  loadAdministrationRefundAttention,
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
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <Suspense fallback={null}>
        <RefundAttention count={refundAttention} />
      </Suspense>
      <section
        aria-labelledby="reservation-activity-heading"
        className="@container"
      >
        <div className="mb-3">
          <h1 className="text-xl" id="reservation-activity-heading">
            {m.administrationOverviewReservationActivityTitle({}, { locale })}
          </h1>
        </div>
        <Suspense fallback={<AdministrationMetricsLoading />}>
          <ReservationActivity locale={locale} overview={reservationOverview} />
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
