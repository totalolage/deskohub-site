import {
  AdministrationCustomerTable,
  AdministrationPage,
  AdministrationTableToolbar,
  Pagination,
} from "@/features/administration/components";
import {
  type AdministrationSearchParams,
  loadAdministrationCustomers,
} from "@/features/administration/page-data.server";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";

export default async function DiscountCustomersAdminPage({
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
