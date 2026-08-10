import type { AdministrationOverviewMetric } from "@/features/administration/administration.service";
import { AdministrationPage } from "@/features/administration/components";
import { loadAdministrationOverview } from "@/features/administration/page-data.server";
import { ReservationLookup } from "@/features/administration/reservation-lookup";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";

export default async function AdminPage() {
  const overview = await loadAdministrationOverview();
  return (
    <AdministrationPage>
      <section aria-labelledby="reservation-activity-heading">
        <div className="mb-3">
          <h1 className="text-xl" id="reservation-activity-heading">
            Reservation activity
          </h1>
        </div>
        <dl className="grid gap-3 lg:grid-cols-3">
          <OverviewMetric
            label="Today"
            metric={overview.today}
            note="Reservations starting today"
          />
          <OverviewMetric
            label="Upcoming"
            metric={overview.upcoming}
            note="Starting in the next 30 days"
          />
          <OverviewMetric
            label="Last 7 days"
            metric={overview.lastSevenDays}
            note="Started during this period"
          />
        </dl>
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

function OverviewMetric({
  label,
  metric,
  note,
}: {
  readonly label: string;
  readonly metric: AdministrationOverviewMetric;
  readonly note: string;
}) {
  return (
    <div className="rounded-xl border border-navy-blue/10 bg-white px-5 py-5 sm:px-6">
      <dt className="text-sm font-semibold text-navy-blue/72">{label}</dt>
      <dd className="mt-4 text-4xl leading-none tracking-[-0.03em]">
        {metric.unavailable ? "—" : metric.value}
      </dd>
      <p className="mt-3 text-xs leading-5 text-navy-blue/58">
        {metric.unavailable ? "Live booking dates unavailable" : note}
      </p>
    </div>
  );
}
