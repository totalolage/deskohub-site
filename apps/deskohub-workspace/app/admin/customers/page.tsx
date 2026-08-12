import { Suspense } from "react";
import {
  AdministrationCustomerTable,
  AdministrationPage,
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
} from "@/features/administration/page-data.server";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";

export default function DiscountCustomersAdminPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const customers = loadAdministrationCustomers(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Customers</h1>
      <AdministrationTableToolbar
        count={
          <Suspense fallback={<AdministrationCountLoading label="customer" />}>
            <CustomerCount customers={customers} />
          </Suspense>
        }
        itemLabel="customer"
        search={<CustomerSearch variant="toolbar" />}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading label="customers" columns={4} />
        }
      >
        <CustomersTable customers={customers} />
      </Suspense>
    </AdministrationPage>
  );
}

async function CustomerCount({
  customers,
}: {
  readonly customers: ReturnType<typeof loadAdministrationCustomers>;
}) {
  return (await customers).total;
}

export async function CustomersTable({
  customers,
}: {
  readonly customers: ReturnType<typeof loadAdministrationCustomers>;
}) {
  const result = await customers;

  return (
    <section className="mt-7">
      <AdministrationCustomerTable customers={result.items} />
      <Pagination
        basePath="/admin/customers"
        page={result.page}
        pageCount={result.pageCount}
      />
    </section>
  );
}

export async function CustomersAdministrationContent({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const customers = await loadAdministrationCustomers(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Customers</h1>
      <AdministrationTableToolbar
        count={customers.total}
        itemLabel="customer"
        search={<CustomerSearch variant="toolbar" />}
      />
      <section className="mt-7">
        <AdministrationCustomerTable customers={customers.items} />
        <Pagination
          basePath="/admin/customers"
          page={customers.page}
          pageCount={customers.pageCount}
        />
      </section>
    </AdministrationPage>
  );
}
