import type { Locale } from "@/features/i18n";
import { formatCount } from "@/shared/utils/number";
import { AdministrationLink as Link } from "./admin-link";
import type { AdministrationOverviewMetric } from "./administration.service";
import { getAdministrationCustomerName } from "./customer-presentation";
import { m } from "./i18n";
import type {
  loadAdministrationOverview,
  loadAdministrationReservationOverview,
} from "./page-data.server";

type OverviewData = Awaited<ReturnType<typeof loadAdministrationOverview>>;
type ReservationOverviewData = Awaited<
  ReturnType<typeof loadAdministrationReservationOverview>
>;

export async function ReservationActivity({
  locale,
  overview,
}: {
  readonly locale: Locale;
  readonly overview: Promise<ReservationOverviewData>;
}) {
  const data = await overview;
  const { ranges } = data;

  return (
    <dl className="grid gap-3 @xl:grid-cols-3">
      <OverviewMetric
        href={getReservationRangeHref(ranges.today)}
        label={m.administrationOverviewTodayLabel({}, { locale })}
        locale={locale}
        metric={data.today}
        note={m.administrationOverviewTodayNote({}, { locale })}
      />
      <OverviewMetric
        href={getReservationRangeHref(ranges.upcoming)}
        label={m.administrationOverviewUpcomingLabel({}, { locale })}
        locale={locale}
        metric={data.upcoming}
        note={m.administrationOverviewUpcomingNote({}, { locale })}
      />
      <OverviewMetric
        href={getReservationRangeHref(ranges.lastSevenDays)}
        label={m.administrationOverviewLastSevenDaysLabel({}, { locale })}
        locale={locale}
        metric={data.lastSevenDays}
        note={m.administrationOverviewLastSevenDaysNote({}, { locale })}
      />
    </dl>
  );
}

export async function CustomerActivity({
  locale,
  overview,
}: {
  readonly locale: Locale;
  readonly overview: Promise<OverviewData>;
}) {
  const { newCustomers, uniqueCustomers } = await overview;

  return (
    <dl className="grid gap-3 @xl:grid-cols-2">
      <CustomerActivityMetric
        label={m.administrationOverviewUniqueCustomersLabel({}, { locale })}
        locale={locale}
        metric={uniqueCustomers}
        unavailableLabel={m.administrationOverviewUniqueCustomerCountUnavailable(
          {},
          { locale }
        )}
        unavailableNote={m.administrationOverviewLiveBookingDatesUnavailable(
          {},
          { locale }
        )}
      />
      <CustomerActivityMetric
        label={m.administrationOverviewNewCustomersLabel({}, { locale })}
        locale={locale}
        metric={newCustomers}
        unavailableLabel={m.administrationOverviewNewCustomerCountUnavailable(
          {},
          { locale }
        )}
        unavailableNote={m.administrationOverviewCustomerCreationDatesUnavailable(
          {},
          { locale }
        )}
      />
    </dl>
  );
}

function CustomerActivityMetric({
  label,
  locale,
  metric,
  unavailableLabel,
  unavailableNote,
}: {
  readonly label: string;
  readonly locale: Locale;
  readonly metric: OverviewData["uniqueCustomers"];
  readonly unavailableLabel: string;
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
            <span className="sr-only">{unavailableLabel}</span>
            <span aria-hidden="true">—</span>
          </>
        ) : (
          formatCount(metric.value, locale)
        )}
      </dd>
      <dd className="mt-3 text-xs leading-5 text-navy-blue/58">
        {metric.unavailable
          ? unavailableNote
          : m.administrationOverviewLastSevenDaysLabel({}, { locale })}
      </dd>
      {!metric.unavailable && (
        <dd className="mt-4 border-t border-navy-blue/10 pt-3 text-xs">
          {metric.value === 0 ? (
            <p className="text-navy-blue/58">
              {m.administrationOverviewNoCustomers({}, { locale })}
            </p>
          ) : (
            <ul>
              {displayedCustomers.map(({ customer, customerId }) => (
                <li key={customerId}>
                  <Link
                    className="block break-words font-semibold transition-colors hover:text-aquamarine-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-blue/40"
                    href={`/admin/customers/${customerId}`}
                  >
                    {customer
                      ? getAdministrationCustomerName(customer, locale)
                      : m.administrationCustomerDetailsUnavailable(
                          {},
                          { locale }
                        )}
                  </Link>
                </li>
              ))}
              {metric.value > 3 && (
                <li className="text-navy-blue/58">
                  {m.administrationOverviewMoreCustomers(
                    { count: metric.value - 2 },
                    { locale }
                  )}
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
  locale,
  metric,
  note,
}: {
  readonly href: string;
  readonly label: string;
  readonly locale: Locale;
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
            <span className="sr-only">
              {m.administrationOverviewReservationCountUnavailable(
                {},
                { locale }
              )}
            </span>
            <span aria-hidden="true">—</span>
          </>
        ) : (
          <>
            <span className="sr-only">
              {m.administrationOverviewReservationCompletion(
                { completed: metric.completed, count: metric.value },
                { locale }
              )}
            </span>
            <span aria-hidden="true" className="text-aquamarine-ink">
              {formatCount(metric.completed, locale)}
            </span>
            <span aria-hidden="true" className="text-lg text-navy-blue/58">
              / {formatCount(metric.value, locale)}
            </span>
          </>
        )}
      </dd>
      <dd className="mt-3 text-xs leading-5 text-navy-blue/58">
        {metric.unavailable
          ? m.administrationOverviewLiveBookingDatesUnavailable({}, { locale })
          : note}
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
