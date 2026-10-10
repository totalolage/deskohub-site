import { Suspense } from "react";
import {
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
  BookingTable,
  Pagination,
} from "@/features/administration/components";
import { BookingsAdministrationFilterForm } from "@/features/administration/filter-forms";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  loadAdministrationBookings,
  loadAdministrationBookingsPage,
} from "@/features/administration/page-data.server";

export default function BookingsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = loadAdministrationBookingsPage(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Bookings</h1>
      <AdministrationTableToolbar
        count={
          <Suspense fallback={<AdministrationCountLoading label="booking" />}>
            <BookingCount result={result} />
          </Suspense>
        }
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={1} />}>
            <BookingFiltersContent input={input} />
          </Suspense>
        }
        itemLabel="booking"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading label="bookings" columns={5} />
        }
      >
        <BookingResultsContent input={input} result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

type BookingsData = Awaited<ReturnType<typeof loadAdministrationBookings>>;

async function BookingCount({
  result,
}: {
  readonly result: Promise<BookingsData["result"]>;
}) {
  return (
    <AdministrationTableCount
      count={(await result).total}
      itemLabel="booking"
    />
  );
}

async function BookingFiltersContent({
  input,
}: {
  readonly input: Promise<BookingsData["input"]>;
}) {
  return <BookingsAdministrationFilterForm input={await input} />;
}

async function BookingResultsContent({
  input,
  result,
}: {
  readonly input: Promise<BookingsData["input"]>;
  readonly result: Promise<BookingsData["result"]>;
}) {
  const [resolvedInput, resolvedResult] = await Promise.all([input, result]);
  return <BookingResults input={resolvedInput} result={resolvedResult} />;
}

function BookingResults({ input, result }: BookingsData) {
  return (
    <>
      <BookingTable
        bookings={result.items}
        sorting={{
          direction: input.direction ?? "asc",
          field: input.sort ?? "booking",
          params: { date: input.date },
        }}
      />
      <Pagination
        basePath="/admin/bookings"
        page={result.page}
        pageCount={result.pageCount}
        params={{
          date: input.date,
          direction: input.direction,
          sort: input.sort,
        }}
      />
    </>
  );
}

export async function BookingsAdministrationContent({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = await loadAdministrationBookings(searchParams);
  return (
    <AdministrationPage>
      <h1 className="sr-only">Bookings</h1>
      <AdministrationTableToolbar
        count={result.total}
        filters={<BookingsAdministrationFilterForm input={input} />}
        itemLabel="booking"
      />
      <BookingResults input={input} result={result} />
    </AdministrationPage>
  );
}
