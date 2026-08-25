import { Suspense } from "react";
import { AdministrationPage } from "@/features/administration/components";
import {
  AdministrationCustomerMetricsLoading,
  AdministrationMetricsLoading,
} from "@/features/administration/loading";
import {
  CustomerActivity,
  ReservationActivity,
} from "@/features/administration/overview-activity";
import { loadAdministrationOverview } from "@/features/administration/page-data.server";
import { ReservationLookup } from "@/features/administration/reservation-lookup";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";

export default function AdminPage() {
  const overview = loadAdministrationOverview();

  return (
    <AdministrationPage>
      <section aria-labelledby="reservation-activity-heading">
        <div className="mb-3">
          <h1 className="text-xl" id="reservation-activity-heading">
            Reservation activity
          </h1>
        </div>
        <Suspense fallback={<AdministrationMetricsLoading />}>
          <ReservationActivity overview={overview} />
        </Suspense>
      </section>

      <section aria-labelledby="customer-activity-heading" className="mt-8">
        <div className="mb-3">
          <h2 className="text-xl" id="customer-activity-heading">
            Customer activity
          </h2>
        </div>
        <Suspense fallback={<AdministrationCustomerMetricsLoading />}>
          <CustomerActivity overview={overview} />
        </Suspense>
      </section>

      <section aria-labelledby="find-heading" className="mt-8">
        <div className="mb-3">
          <h2 className="text-xl" id="find-heading">
            Find a record
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
