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
  loadAdministrationReservations,
  loadAdministrationReservationsPage,
} from "@/features/administration/page-data.server";
import { RefundAttention } from "@/features/administration/refund-attention";
import {
  getAdministrationReservationDateShortcuts,
  getAdministrationReservationListDefaultDateRange,
} from "@/features/administration/reservation-date-range";
import { ReservationLookup } from "@/features/administration/reservation-lookup";

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
            fallback={<AdministrationCountLoading label="reservation" />}
          >
            <ReservationCount result={result} />
          </Suspense>
        }
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={4} />}>
            <ReservationFiltersContent input={input} />
          </Suspense>
        }
        itemLabel="reservation"
        search={<ReservationLookup variant="toolbar" />}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading label="reservations" columns={6} />
        }
      >
        <ReservationResultsContent input={input} result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

type ReservationsData = Awaited<
  ReturnType<typeof loadAdministrationReservations>
>;

async function ReservationCount({
  result,
}: {
  readonly result: Promise<ReservationsData["result"]>;
}) {
  return (
    <AdministrationTableCount
      count={(await result).total}
      itemLabel="reservation"
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
  return <ReservationResults input={resolvedInput} result={resolvedResult} />;
}

export async function ReservationsAdministrationContent({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = await loadAdministrationReservations(searchParams);
  return (
    <>
      <h1 className="sr-only">Reservations</h1>
      <AdministrationTableToolbar
        count={result.total}
        filters={
          <ReservationsAdministrationFilterForm
            defaultFrom={
              getAdministrationReservationListDefaultDateRange().from
            }
            input={input}
            shortcuts={getAdministrationReservationDateShortcuts()}
          />
        }
        itemLabel="reservation"
        search={<ReservationLookup variant="toolbar" />}
      />
      <ReservationResults input={input} result={result} />
    </>
  );
}

function ReservationResults({ input, result }: ReservationsData) {
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
