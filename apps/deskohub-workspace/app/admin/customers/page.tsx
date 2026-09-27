import { Suspense } from "react";
import {
  AdministrationCustomerTable,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
  Pagination,
} from "@/features/administration/components";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  loadAdministrationCustomers,
  loadAdministrationCustomersPage,
} from "@/features/administration/page-data.server";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
import { CustomerCountPending } from "./customer-count-pending";
import { CustomerConsentFilterForm } from "./customer-consent-filter-form";
import { CustomerFilterNavigationProvider } from "./customer-filter-navigation";
import { CustomerResultsPendingOverlay } from "./customer-results-pending-overlay";

export default function DiscountCustomersAdminPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = loadAdministrationCustomersPage(searchParams);

  return (
    <CustomerFilterNavigationProvider>
      <AdministrationPage>
        <h1 className="sr-only">Customers</h1>
        <AdministrationTableToolbar
          count={
            <CustomerCountPending>
              <Suspense fallback={<AdministrationCountLoading label="customer" />}>
                <CustomerCount result={result} />
              </Suspense>
            </CustomerCountPending>
          }
          filters={<CustomerConsentFilterForm />}
          itemLabel="customer"
          search={<CustomerSearch variant="toolbar" />}
        />
        <Suspense
          fallback={
            <AdministrationCollectionLoading label="customers" columns={4} />
          }
        >
          <CustomersTable input={input} result={result} />
        </Suspense>
      </AdministrationPage>
    </CustomerFilterNavigationProvider>
  );
}

type CustomersData = Awaited<ReturnType<typeof loadAdministrationCustomers>>;

async function CustomerCount({
  result,
}: {
  readonly result: Promise<CustomersData["result"]>;
}) {
  return (
    <AdministrationTableCount
      count={(await result).total}
      itemLabel="customer"
    />
  );
}

export async function CustomersTable({
  input,
  result,
}: {
  readonly input: Promise<CustomersData["input"]>;
  readonly result: Promise<CustomersData["result"]>;
}) {
  const [resolvedInput, resolvedResult] = await Promise.all([input, result]);

  return (
    <section className="mt-7">
      <CustomerResultsPendingOverlay>
        <AdministrationCustomerTable
          consent={resolvedInput.marketingConsent}
          customers={resolvedResult.items}
          sorting={{
            direction: resolvedInput.direction ?? "desc",
            field: resolvedInput.sort ?? "activity",
            params: {
              consent: resolvedInput.marketingConsent,
            },
          }}
        />
        <Pagination
          basePath="/admin/customers"
          page={resolvedResult.page}
          pageCount={resolvedResult.pageCount}
          params={{
            consent: resolvedInput.marketingConsent,
            direction: resolvedInput.direction,
            sort: resolvedInput.sort,
          }}
        />
      </CustomerResultsPendingOverlay>
    </section>
  );
}

export async function CustomersAdministrationContent({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = await loadAdministrationCustomers(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Customers</h1>
      <AdministrationTableToolbar
        count={result.total}
        itemLabel="customer"
        search={<CustomerSearch variant="toolbar" />}
      />
      <section className="mt-7">
        <AdministrationCustomerTable
          consent={input.marketingConsent}
          customers={result.items}
          sorting={{
            direction: input.direction ?? "desc",
            field: input.sort ?? "activity",
            params: {
              consent: input.marketingConsent,
            },
          }}
        />
        <Pagination
          basePath="/admin/customers"
          page={result.page}
          pageCount={result.pageCount}
          params={{
            consent: input.marketingConsent,
            direction: input.direction,
            sort: input.sort,
          }}
        />
      </section>
    </AdministrationPage>
  );
}
