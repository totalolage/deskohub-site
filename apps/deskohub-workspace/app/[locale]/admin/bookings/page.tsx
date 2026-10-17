import { Suspense } from "react";
import {
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
  BookingTable,
  Pagination,
} from "@/features/administration/components";
import { BookingsAdministrationFilterForm } from "@/features/administration/filter-forms";
import { m } from "@/features/administration/i18n";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  loadAdministrationBookingsPage,
} from "@/features/administration/page-data.server";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function BookingsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  return <BookingsAdministration searchParams={searchParams} />;
}

async function BookingsAdministration({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const locale = await getRequestLocale();
  const { input, result } = loadAdministrationBookingsPage(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">
        {m.administrationBookingListTitle({}, { locale })}
      </h1>
      <AdministrationTableToolbar
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.administrationBookingCountLoading({}, { locale })}
              />
            }
          >
            <BookingCount locale={locale} result={result} />
          </Suspense>
        }
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={1} />}>
            <BookingFiltersContent input={input} />
          </Suspense>
        }
        label={m.administrationBookingTableControls({}, { locale })}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            label={m.administrationBookingListLoading({}, { locale })}
            columns={5}
          />
        }
      >
        <BookingResultsContent input={input} locale={locale} result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

type BookingsPage = ReturnType<typeof loadAdministrationBookingsPage>;
type BookingsData = {
  readonly input: Awaited<BookingsPage["input"]>;
  readonly result: Awaited<BookingsPage["result"]>;
};

async function BookingCount({
  locale,
  result,
}: {
  readonly locale: Locale;
  readonly result: Promise<BookingsData["result"]>;
}) {
  const count = (await result).total;
  return (
    <AdministrationTableCount
      count={count}
      label={m.administrationBookingCount({ count }, { locale })}
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
  locale,
  result,
}: {
  readonly input: Promise<BookingsData["input"]>;
  readonly locale: Locale;
  readonly result: Promise<BookingsData["result"]>;
}) {
  const [resolvedInput, resolvedResult] = await Promise.all([input, result]);
  return (
    <BookingResults
      input={resolvedInput}
      locale={locale}
      result={resolvedResult}
    />
  );
}

function BookingResults({
  input,
  locale,
  result,
}: BookingsData & { readonly locale: Locale }) {
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
        locale={locale}
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
