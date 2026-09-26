import { Suspense } from "react";
import {
  AdministrationCustomerTable,
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterSelect,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
  Pagination,
} from "@/features/administration/components";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  loadAdministrationCustomers,
  loadAdministrationCustomersPage,
} from "@/features/administration/page-data.server";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

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
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={1} />}>
            <CustomerFiltersContent input={input} />
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

async function CustomerFiltersContent({
  input,
}: {
  readonly input: Promise<CustomersData["input"]>;
}) {
  return <CustomerFilters input={await input} />;
}

export function CustomerFilters({
  input,
}: {
  readonly input: CustomersData["input"];
}) {
  return (
    <AdministrationFilterForm variant="toolbar">
      <AdministrationFilterField
        htmlFor="customer-consent"
        label={m.adminCustomersFilterConsentLabel({})}
      >
        <AdministrationFilterSelect
          defaultValue={input.marketingConsent ?? ""}
          id="customer-consent"
          name="consent"
        >
          <option value="">{m.adminCustomersFilterConsentAll({})}</option>
          <option value="granted">
            {m.adminCustomersFilterConsentGranted({})}
          </option>
          <option value="withdrawn">
            {m.adminCustomersFilterConsentWithdrawn({})}
          </option>
          <option value="never">
            {m.adminCustomersFilterConsentNeverGranted({})}
          </option>
        </AdministrationFilterSelect>
      </AdministrationFilterField>
      <input name="sort" type="hidden" value={input.sort} />
      <input name="direction" type="hidden" value={input.direction} />
      <div className="sm:col-span-2 2xl:col-span-1 2xl:justify-self-end">
        <Button className="min-h-10" size="sm" type="submit">
          {m.adminCustomersFilterApply({})}
        </Button>
      </div>
    </AdministrationFilterForm>
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
