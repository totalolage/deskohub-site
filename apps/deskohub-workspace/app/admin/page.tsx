import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import type { AdministrationOverviewMetric } from "@/features/administration/administration.service";
import { AdministrationPage } from "@/features/administration/components";
import { AdministrationMetricsLoading } from "@/features/administration/loading";
import { loadAdministrationOverview } from "@/features/administration/page-data.server";
import { ReservationLookup } from "@/features/administration/reservation-lookup";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";

export default function AdminPage() {
  return (
    <AdministrationPage>
      <section aria-labelledby="reservation-activity-heading">
        <div className="mb-3">
          <h1 className="text-xl" id="reservation-activity-heading">
            Reservation activity
          </h1>
        </div>
        <Suspense fallback={<AdministrationMetricsLoading />}>
          <ReservationActivity />
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

export async function ReservationActivity() {
  const overview = await loadAdministrationOverview();
  const { ranges } = overview;

  return (
    <dl className="grid gap-3 lg:grid-cols-3">
      <OverviewMetric
        href={getReservationRangeHref(ranges.today)}
        label="Today"
        metric={overview.today}
        note="Reservations starting today"
      />
      <OverviewMetric
        href={getReservationRangeHref(ranges.upcoming)}
        label="Upcoming"
        metric={overview.upcoming}
        note="Starting in the next 30 days"
      />
      <OverviewMetric
        href={getReservationRangeHref(ranges.lastSevenDays)}
        label="Last 7 days"
        metric={overview.lastSevenDays}
        note="Started during this period"
      />
    </dl>
  );
}

function OverviewMetric({
  href,
  label,
  metric,
  note,
}: {
  readonly href: string;
  readonly label: string;
  readonly metric: AdministrationOverviewMetric;
  readonly note: string;
}) {
  return (
    <div className="relative rounded-xl border border-navy-blue/10 bg-white px-5 py-5 sm:px-6">
      <dt className="text-sm font-semibold text-navy-blue/72">
        <Link
          className="before:absolute before:inset-0 before:rounded-xl before:content-[''] hover:underline focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
          href={href}
        >
          {label}
        </Link>
      </dt>
      <dd className="mt-4 text-4xl leading-none tracking-[-0.03em]">
        {metric.unavailable ? "—" : metric.value}
      </dd>
      <dd className="mt-3 text-xs leading-5 text-navy-blue/58">
        {metric.unavailable ? "Live booking dates unavailable" : note}
      </dd>
    </div>
  );
}

const getReservationRangeHref = ({
  from,
  to,
}: {
  readonly from: string;
  readonly to: string;
}) => `/admin/reservations?from=${from}&to=${to}`;
