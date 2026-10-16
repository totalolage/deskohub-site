import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationAlert,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
  Pagination,
  ReservationTable,
} from "@/features/administration/components";
import { ReservationsAdministrationFilterForm } from "@/features/administration/filter-forms";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  loadAdministrationRefundAttention,
  loadAdministrationReservationsPage,
} from "@/features/administration/page-data.server";
import { RefundAttention } from "@/features/administration/refund-attention";
import {
  getAdministrationReservationDateShortcuts,
  getAdministrationReservationListDefaultDateRange,
} from "@/features/administration/reservation-date-range";
import { ReservationLookup } from "@/features/administration/reservation-lookup";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function ReservationsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = loadAdministrationReservationsPage(searchParams);
  const refundAttention = loadAdministrationRefundAttention();

  return (
    <AdministrationPage>
      <h1 className="sr-only">Reservations</h1>
      <Suspense fallback={null}>
        <ReservationRefundAttention count={refundAttention} input={input} />
      </Suspense>
      <AdministrationTableToolbar
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading label="Loading reservation count" />
            }
          >
            <ReservationCount result={result} />
          </Suspense>
        }
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={4} />}>
            <ReservationFiltersContent input={input} />
          </Suspense>
        }
        label="reservation table controls"
        search={<ReservationLookup variant="toolbar" />}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            label="Loading reservations"
            columns={6}
          />
        }
      >
        <ReservationResultsContent input={input} result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

type ReservationsPage = ReturnType<typeof loadAdministrationReservationsPage>;
type ReservationsData = {
  readonly input: Awaited<ReservationsPage["input"]>;
  readonly result: Awaited<ReservationsPage["result"]>;
};

async function ReservationCount({
  result,
}: {
  readonly result: Promise<ReservationsData["result"]>;
}) {
  const count = (await result).total;
  return (
    <AdministrationTableCount
      count={count}
      label={`${count} reservation${count === 1 ? "" : "s"}`}
    />
  );
}

async function ReservationRefundAttention({
  count,
  input,
}: {
  readonly count: Promise<number>;
  readonly input: Promise<ReservationsData["input"]>;
}) {
  // The filtered list already is the refund work queue.
  if ((await input).status === "needs_refund") return null;
  return <RefundAttention count={count} />;
}

async function ReservationFiltersContent({
  input,
}: {
  readonly input: Promise<ReservationsData["input"]>;
}) {
  const resolvedInput = await input;

  return (
    <ReservationsAdministrationFilterForm
      defaultFrom={getAdministrationReservationListDefaultDateRange().from}
      input={resolvedInput}
      shortcuts={getAdministrationReservationDateShortcuts()}
    />
  );
}

async function ReservationResultsContent({
  input,
  result,
}: {
  readonly input: Promise<ReservationsData["input"]>;
  readonly result: Promise<ReservationsData["result"]>;
}) {
  const [resolvedInput, resolvedResult] = await Promise.all([input, result]);
  const locale = await getRequestLocale();
  return (
    <ReservationResults
      input={resolvedInput}
      locale={locale}
      result={resolvedResult}
    />
  );
}

function ReservationResults({
  input,
  locale,
  result,
}: ReservationsData & { readonly locale: Locale }) {
  const clearCustomerSearch = new URLSearchParams();
  for (const [key, value] of Object.entries({
    direction: input.direction,
    from: input.from,
    sort: input.sort,
    status: input.status,
    to: input.to,
    type: input.type,
  })) {
    if (value) clearCustomerSearch.set(key, value);
  }
  const clearCustomerQuery = clearCustomerSearch.toString();
  const clearCustomerHref = clearCustomerQuery
    ? `/admin/reservations?${clearCustomerQuery}`
    : "/admin/reservations";
  return (
    <>
      {input.customerId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-blue/10 bg-white px-4 py-3 text-sm">
          <p>Showing reservations for the selected customer.</p>
          <Link
            className="font-semibold hover:underline"
            href={clearCustomerHref}
          >
            Clear customer
          </Link>
        </div>
      )}
      {result.dateFilterUnavailable && (
        <AdministrationAlert className="mb-4" status="warning">
          Booking dates are temporarily unavailable. Try this date again
          shortly.
        </AdministrationAlert>
      )}
      {result.dateSortUnavailable && (
        <AdministrationAlert className="mb-4" status="warning">
          Reservation dates are temporarily unavailable for sorting. Showing
          newest records instead.
        </AdministrationAlert>
      )}
      <ReservationTable
        reservations={result.items}
        sorting={{
          basePath: "/admin/reservations",
          direction: input.direction ?? "desc",
          field: input.sort ?? "created",
          params: {
            from: input.from,
            to: input.to,
            customerId: input.customerId,
            status: input.status,
            type: input.type,
          },
        }}
      />
      <Pagination
        basePath="/admin/reservations"
        locale={locale}
        page={result.page}
        pageCount={result.pageCount}
        params={{
          customerId: input.customerId,
          direction: input.direction,
          from: input.from,
          sort: input.sort,
          status: input.status,
          to: input.to,
          type: input.type,
        }}
      />
    </>
  );
}
