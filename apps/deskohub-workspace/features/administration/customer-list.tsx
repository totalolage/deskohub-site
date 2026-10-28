import { Suspense } from "react";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { AdministrationCustomerTable, Pagination } from "./components";
import { customerListQuery } from "./customer-list-query";
import { CustomersAdministrationFilterForm } from "./filter-forms";
import { m } from "./i18n";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "./loading";
import { AdministrationAlert } from "./notice";
import {
  type AdministrationSearchParams,
  loadAdministrationCustomersPage,
} from "./page-data.server";
import { AdministrationPage } from "./page-frame";
import { getAdministrationReservationDateShortcuts } from "./reservation-date-range";
import {
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "./table-toolbar";

type CustomersPage = ReturnType<typeof loadAdministrationCustomersPage>;
type CustomersData = {
  readonly input: Awaited<CustomersPage["input"]>;
  readonly result: Awaited<CustomersPage["result"]>;
};

/**
 * The customer list screen. It awaits only the route locale, which
 * prerendering knows, and streams the count, filters and table separately.
 */
export async function AdministrationCustomerList({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = loadAdministrationCustomersPage(searchParams);
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <h1 className="sr-only">
        {m.administrationCustomerListTitle({}, { locale })}
      </h1>
      <AdministrationTableToolbar
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.administrationCustomerCountLoading({}, { locale })}
              />
            }
          >
            <CustomerCount locale={locale} result={result} />
          </Suspense>
        }
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={3} />}>
            <CustomerFilters input={input} />
          </Suspense>
        }
        exportHref={input.then(customerListQuery.exportHref)}
        label={m.administrationCustomerTableControls({}, { locale })}
        search={<CustomerSearch variant="toolbar" />}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            label={m.administrationCustomerListLoading({}, { locale })}
            columns={4}
          />
        }
      >
        <CustomersTable input={input} locale={locale} result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

async function CustomerCount({
  locale,
  result,
}: {
  readonly locale: Locale;
  readonly result: Promise<CustomersData["result"]>;
}) {
  const count = (await result).total;
  return (
    <AdministrationTableCount
      count={count}
      label={m.administrationCustomerCount({ count }, { locale })}
    />
  );
}

async function CustomerFilters({
  input,
}: {
  readonly input: Promise<CustomersData["input"]>;
}) {
  const resolvedInput = await input;
  return (
    <CustomersAdministrationFilterForm
      query={resolvedInput}
      shortcuts={getAdministrationReservationDateShortcuts()}
    />
  );
}

async function CustomersTable({
  input,
  locale,
  result,
}: {
  readonly input: Promise<CustomersData["input"]>;
  readonly locale: Locale;
  readonly result: Promise<CustomersData["result"]>;
}) {
  const [resolvedInput, resolvedResult] = await Promise.all([input, result]);
  // Membership is unknown, so neither rows nor "no matches" would be true.
  if (resolvedResult.dateFilterUnavailable) {
    return (
      <section className="mt-7">
        <AdministrationAlert status="warning">
          {m.administrationCustomerListDateFilterUnavailable({}, { locale })}
        </AdministrationAlert>
      </section>
    );
  }
  return (
    <section className="mt-7">
      <AdministrationCustomerTable
        customers={resolvedResult.items}
        filtered={Boolean(
          resolvedInput.from ||
            resolvedInput.to ||
            resolvedInput.marketingConsent
        )}
        query={resolvedInput}
      />
      <Pagination
        href={(page) => customerListQuery.href(resolvedInput, { page })}
        locale={locale}
        page={resolvedResult.page}
        pageCount={resolvedResult.pageCount}
      />
    </section>
  );
}
