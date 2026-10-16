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
  loadAdministrationCustomersPage,
} from "@/features/administration/page-data.server";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";

export default function DiscountCustomersAdminPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = loadAdministrationCustomersPage(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Customers</h1>
      <AdministrationTableToolbar
        count={
          <Suspense fallback={<AdministrationCountLoading label="customer" />}>
            <CustomerCount result={result} />
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
        <CustomersTable input={input} result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

type CustomersPage = ReturnType<typeof loadAdministrationCustomersPage>;
type CustomersData = {
  readonly input: Awaited<CustomersPage["input"]>;
  readonly result: Awaited<CustomersPage["result"]>;
};

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
      <AdministrationCustomerTable
        customers={resolvedResult.items}
        sorting={{
          direction: resolvedInput.direction ?? "desc",
          field: resolvedInput.sort ?? "activity",
        }}
      />
      <Pagination
        basePath="/admin/customers"
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
