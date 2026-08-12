import { Suspense } from "react";
import {
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
  BookingTable,
  Pagination,
} from "@/features/administration/components";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  type loadAdministrationBookings,
  loadAdministrationBookingsPage,
} from "@/features/administration/page-data.server";
import { Button } from "@/shared/components/ui/button";

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
  return <BookingFilters input={await input} />;
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

function BookingFilters({ input }: { readonly input: BookingsData["input"] }) {
  return (
    <AdministrationFilterForm variant="standalone">
      <AdministrationFilterField htmlFor="booking-date" label="Booking date">
        <AdministrationFilterInput
          defaultValue={input.date}
          id="booking-date"
          name="date"
          required
          type="date"
        />
      </AdministrationFilterField>
      <Button className="min-h-10" size="sm" type="submit">
        Show bookings
      </Button>
    </AdministrationFilterForm>
  );
}

function BookingResults({ input, result }: BookingsData) {
  return (
    <>
      <BookingTable bookings={result.items} />
      <Pagination
        basePath="/admin/bookings"
        page={result.page}
        pageCount={result.pageCount}
        params={{ date: input.date }}
      />
    </>
  );
}
