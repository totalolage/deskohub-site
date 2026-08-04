import { Search } from "lucide-react";
import Link from "next/link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  ReservationTable,
} from "@/features/administration/components";
import { loadAdministrationOverview } from "@/features/administration/page-data.server";
import { ReservationLifecycleMap } from "@/features/administration/reservation-lifecycle-map";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const overview = await loadAdministrationOverview();
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        description="Find a reservation, understand what happened, and move between related customer records."
        eyebrow="Operations"
        title="Workspace overview"
      />

      <dl className="mb-7 grid overflow-hidden rounded-xl border border-navy-blue/10 bg-white sm:grid-cols-3 sm:divide-x sm:divide-navy-blue/10">
        <OverviewCount
          label="Reservations"
          value={overview.counts.reservations}
        />
        <OverviewCount label="Customers" value={overview.counts.customers} />
        <OverviewCount
          attention={overview.counts.attention > 0}
          label="Needs attention"
          value={overview.counts.attention}
        />
      </dl>

      <section aria-labelledby="find-heading" className="mb-9">
        <div className="mb-3">
          <h2 className="text-xl" id="find-heading">
            Find a record
          </h2>
          <p className="mt-1 text-sm text-navy-blue/65">
            Search reservations by ID, or customers by their exact contact
            details.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <form
            action="/admin/reservations"
            className="grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="reservation-query">Reservation ID</Label>
              <Input
                autoComplete="off"
                id="reservation-query"
                name="query"
                placeholder="Reservation ID"
                required
              />
            </div>
            <Button type="submit">
              <Search aria-hidden className="size-4" />
              Find reservation
            </Button>
          </form>
          <CustomerSearch compact />
        </div>
      </section>

      <OverviewSection
        actionHref="/admin/reservations?status=attention"
        actionLabel="View attention queue"
        description="Reservations with confirmation or cancellation issues."
        title="Needs attention"
      >
        <ReservationTable
          emptyMessage="No reservations currently need attention."
          reservations={overview.attention}
        />
      </OverviewSection>

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
            A simple view of the normal path and the states that need an
            operator’s attention.
          </p>
        </div>
        <ReservationLifecycleMap />
      </section>
    </AdministrationPage>
  );
}

function OverviewCount({
  attention = false,
  label,
  value,
}: {
  readonly attention?: boolean;
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/65">
        {label}
      </dt>
      <dd
        className={
          attention ? "mt-2 text-2xl text-burned-orange-ink" : "mt-2 text-2xl"
        }
      >
        {value}
      </dd>
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
