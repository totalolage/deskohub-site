import { AdministrationLink as Link } from "./admin-link";
import type { AdministrationOverviewMetric } from "./administration.service";
import type {
  loadAdministrationOverview,
  loadAdministrationReservationOverview,
} from "./page-data.server";

type OverviewData = Awaited<ReturnType<typeof loadAdministrationOverview>>;
type ReservationOverviewData = Awaited<
  ReturnType<typeof loadAdministrationReservationOverview>
>;

export async function ReservationActivity({
  overview,
}: {
  readonly overview: Promise<ReservationOverviewData>;
}) {
  const data = await overview;
  const { ranges } = data;

  return (
    <dl className="grid gap-3 lg:grid-cols-3">
      <OverviewMetric
        href={getReservationRangeHref(ranges.today)}
        label="Today"
        metric={data.today}
        note="Reservations starting today"
      />
      <OverviewMetric
        href={getReservationRangeHref(ranges.upcoming)}
        label="Upcoming"
        metric={data.upcoming}
        note="Starting in the next 30 days"
      />
      <OverviewMetric
        href={getReservationRangeHref(ranges.lastSevenDays)}
        label="Last 7 days"
        metric={data.lastSevenDays}
        note="Started during this period"
      />
    </dl>
  );
}

export async function CustomerActivity({
  overview,
}: {
  readonly overview: Promise<OverviewData>;
}) {
  const { newCustomers, uniqueCustomers } = await overview;

  return (
    <dl className="grid gap-3 lg:grid-cols-2">
      <CustomerActivityMetric
        label="Unique customers"
        metric={uniqueCustomers}
        unavailableNote="Live booking dates unavailable"
      />
      <CustomerActivityMetric
        label="New customers"
        metric={newCustomers}
        unavailableNote="Customer creation dates unavailable"
      />
    </dl>
  );
}

function CustomerActivityMetric({
  label,
  metric,
  unavailableNote,
}: {
  readonly label: string;
  readonly metric: OverviewData["uniqueCustomers"];
  readonly unavailableNote: string;
}) {
  const displayedCustomers = metric.customers.slice(
    0,
    metric.value > 3 ? 2 : 3
  );

  return (
    <div className="rounded-xl border border-navy-blue/10 bg-white px-5 py-5 sm:px-6">
      <dt className="text-sm font-semibold text-navy-blue/72">{label}</dt>
      <dd className="mt-4 text-4xl leading-none tracking-[-0.03em] text-aquamarine-ink">
        {metric.unavailable ? (
          <>
            <span className="sr-only">
              {label.slice(0, -1)} count unavailable
            </span>
            <span aria-hidden="true">—</span>
          </>
        ) : (
          metric.value
        )}
      </dd>
      <dd className="mt-3 text-xs leading-5 text-navy-blue/58">
        {metric.unavailable ? unavailableNote : "Last 7 days"}
      </dd>
      {!metric.unavailable && (
        <dd className="mt-4 border-t border-navy-blue/10 pt-3 text-xs">
          {metric.value === 0 ? (
            <p className="py-1 text-navy-blue/58">
              No customers in this period
            </p>
          ) : (
            <ul className="space-y-1">
              {displayedCustomers.map(({ customer, customerId }) => (
                <li key={customerId}>
                  <Link
                    className="block break-words py-1 font-semibold transition-colors hover:text-aquamarine-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-blue/40"
                    href={`/admin/customers/${customerId}`}
                  >
                    {customer?.displayName ?? "Details unavailable"}
                  </Link>
                </li>
              ))}
              {metric.value > 3 && (
                <li className="py-1 text-navy-blue/58">
                  … and {metric.value - 2} more
                </li>
              )}
            </ul>
          )}
        </dd>
      )}
    </div>
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
      <dd className="mt-4 flex items-baseline gap-2 text-4xl leading-none tracking-[-0.03em]">
        {metric.unavailable ? (
          <>
            <span className="sr-only">Reservation count unavailable</span>
            <span aria-hidden="true">—</span>
          </>
        ) : (
          <>
            <span className="sr-only">
              {metric.completed} completed out of {metric.value} total
              reservations
            </span>
            <span aria-hidden="true" className="text-aquamarine-ink">
              {metric.completed}
            </span>
            <span aria-hidden="true" className="text-lg text-navy-blue/58">
              / {metric.value}
            </span>
          </>
        )}
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
