import { Suspense } from "react";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { AdministrationCustomerTable, Pagination } from "./components";
import { m } from "./i18n";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
} from "./loading";
import {
  type AdministrationSearchParams,
  loadAdministrationCustomersPage,
} from "./page-data.server";
import { AdministrationPage } from "./page-frame";
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
 * prerendering knows, and streams the count and table separately.
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

  return (
    <section className="mt-7">
      <AdministrationCustomerTable
        customers={resolvedResult.items}
        sorting={{
          direction: resolvedInput.direction ?? "desc",
          field: resolvedInput.sort ?? "activity",
        }}
      />
      <Pagination
        basePath="/admin/customers"
        locale={locale}
        page={resolvedResult.page}
        pageCount={resolvedResult.pageCount}
        params={{
          direction: resolvedInput.direction,
          sort: resolvedInput.sort,
        }}
      />
    </section>
  );
}
