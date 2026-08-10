import Link from "next/link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  ReservationTable,
} from "@/features/administration/components";
import { loadAdministrationOverview } from "@/features/administration/page-data.server";
import { ReservationLifecycleMap } from "@/features/administration/reservation-lifecycle-map";
import { ReservationLookup } from "@/features/administration/reservation-lookup";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";

export default async function AdminPage() {
  const overview = await loadAdministrationOverview();
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        description="Find a reservation, understand what happened, and move between related customer records."
        eyebrow="Operations"
        title="Workspace overview"
      />

      <dl className="mb-7 grid overflow-hidden rounded-xl border border-navy-blue/10 bg-white sm:grid-cols-2 sm:divide-x sm:divide-navy-blue/10">
        <OverviewCount
          label="Reservations"
          value={overview.counts.reservations}
        />
        <OverviewCount label="Customers" value={overview.counts.customers} />
      </dl>

      <section aria-labelledby="find-heading" className="mb-9">
        <div className="mb-3">
          <h2 className="text-xl" id="find-heading">
            Find a record
          </h2>
          <p className="mt-1 text-sm text-navy-blue/65">
            Paste an associated ID to open a reservation, or search for a
            customer by name or email.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <ReservationLookup />
          <CustomerSearch />
        </div>
      </section>

      <OverviewSection
        actionHref={`/admin/reservations?date=${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Prague" })}`}
        actionLabel="View today"
        description="Reservations beginning today in Prague."
        title="Today"
      >
        {overview.todayUnavailable ? (
          <output className="block rounded-lg bg-sunset-yellow/15 px-4 py-3 text-sm">
            Today’s booking dates are temporarily unavailable. Try again
            shortly.
          </output>
        ) : (
          <ReservationTable
            emptyMessage="No reservations begin today."
            reservations={overview.today}
          />
        )}
      </OverviewSection>

      <OverviewSection
        actionHref="/admin/reservations"
        actionLabel="View all reservations"
        description="The reservations with the latest changes."
        title="Recent changes"
      >
        <ReservationTable reservations={overview.recent} />
      </OverviewSection>

      <section aria-labelledby="lifecycle-heading" className="mt-12">
        <div className="mb-4 max-w-2xl">
          <h2 className="text-2xl" id="lifecycle-heading">
            How reservations progress
          </h2>
          <p className="mt-2 text-sm leading-6 text-navy-blue/65">
            A simple view of the normal path and alternate outcomes.
          </p>
        </div>
        <ReservationLifecycleMap />
      </section>
    </AdministrationPage>
  );
}

function OverviewCount({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/65">
        {label}
      </dt>
      <dd className="mt-2 text-2xl">{value}</dd>
    </div>
  );
}

function OverviewSection({
  actionHref,
  actionLabel,
  children,
  description,
  title,
}: {
  readonly actionHref: string;
  readonly actionLabel: string;
  readonly children: React.ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <section className="mb-9">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl">{title}</h2>
          <p className="mt-1 text-sm text-navy-blue/65">{description}</p>
        </div>
        <Link
          className="text-sm font-semibold hover:underline"
          href={actionHref}
        >
          {actionLabel} →
        </Link>
      </div>
      {children}
    </section>
  );
}
