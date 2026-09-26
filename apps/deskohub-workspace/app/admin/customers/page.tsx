import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationAlert,
  AdministrationCustomerTable,
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
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
import {
  type AdministrationReservationDateRange,
  getAdministrationReservationDateShortcuts,
} from "@/features/administration/reservation-date-range";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
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
          <Suspense fallback={<AdministrationFiltersLoading fields={2} />}>
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

function CustomerFilters({
  input,
}: {
  readonly input: CustomersData["input"];
}) {
  const shortcutRanges = getAdministrationReservationDateShortcuts();
  const shortcutHref = (range: AdministrationReservationDateRange) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({
      direction: input.direction,
      from: range.from,
      sort: input.sort,
      to: range.to,
    })) {
      if (value) search.set(key, value);
    }
    return `/admin/customers?${search.toString()}`;
  };

  return (
    <AdministrationFilterForm className="2xl:grid-cols-[10rem_10rem_10rem]">
      <AdministrationFilterField
        htmlFor="customer-date-from"
        label="Start date from"
      >
        <AdministrationFilterInput
          defaultValue={input.from ?? ""}
          id="customer-date-from"
          name="from"
          type="date"
        />
      </AdministrationFilterField>
      <AdministrationFilterField
        htmlFor="customer-date-to"
        label="Start date to"
      >
        <AdministrationFilterInput
          defaultValue={input.to ?? ""}
          id="customer-date-to"
          name="to"
          type="date"
        />
      </AdministrationFilterField>
      <input name="sort" type="hidden" value={input.sort} />
      <input name="direction" type="hidden" value={input.direction} />
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between 2xl:col-span-3">
        <nav
          aria-label="Customer date shortcuts"
          className="flex flex-wrap items-center gap-2"
        >
          {(
            [
              ["Today", shortcutRanges.today],
              ["Upcoming", shortcutRanges.upcoming],
              ["Past", shortcutRanges.past],
            ] as const
          ).map(([label, range]) => (
            <Button asChild key={label} size="sm" variant="secondary">
              <Link href={shortcutHref(range)}>{label}</Link>
            </Button>
          ))}
        </nav>
        <fieldset
          aria-label="Filter actions"
          className="flex min-w-0 items-center justify-end gap-2 border-0 p-0"
        >
          {(input.from || input.to) && (
            <Button asChild className="min-h-10" size="sm" variant="ghost">
              <Link href="/admin/customers">Clear</Link>
            </Button>
          )}
          <Button className="min-h-10" size="sm" type="submit">
            Apply filters
          </Button>
        </fieldset>
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
      {resolvedResult.dateFilterUnavailable && (
        <AdministrationAlert className="mb-4" status="warning">
          Booking dates are temporarily unavailable. Try this date range again
          shortly.
        </AdministrationAlert>
      )}
      <AdministrationCustomerTable
        customers={resolvedResult.items}
        sorting={{
          direction: resolvedInput.direction ?? "desc",
          field: resolvedInput.sort ?? "activity",
          params: {
            direction: resolvedInput.direction,
            from: resolvedInput.from,
            sort: resolvedInput.sort,
            to: resolvedInput.to,
          },
        }}
      />
      <Pagination
        basePath="/admin/customers"
        page={resolvedResult.page}
        pageCount={resolvedResult.pageCount}
        params={{
          direction: resolvedInput.direction,
          from: resolvedInput.from,
          sort: resolvedInput.sort,
          to: resolvedInput.to,
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
        filters={<CustomerFilters input={input} />}
        itemLabel="customer"
        search={<CustomerSearch variant="toolbar" />}
      />
      <section className="mt-7">
        {result.dateFilterUnavailable && (
          <AdministrationAlert className="mb-4" status="warning">
            Booking dates are temporarily unavailable. Try this date range again
            shortly.
          </AdministrationAlert>
        )}
        <AdministrationCustomerTable
          customers={result.items}
          sorting={{
            direction: input.direction ?? "desc",
            field: input.sort ?? "activity",
            params: {
              direction: input.direction,
              from: input.from,
              sort: input.sort,
              to: input.to,
            },
          }}
        />
        <Pagination
          basePath="/admin/customers"
          page={result.page}
          pageCount={result.pageCount}
          params={{
            direction: input.direction,
            from: input.from,
            sort: input.sort,
            to: input.to,
          }}
        />
      </section>
    </AdministrationPage>
  );
}
