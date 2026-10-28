import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { AdministrationLink as Link } from "./admin-link";
import { Pagination } from "./components";
import { ReservationsAdministrationFilterForm } from "./filter-forms";
import { m } from "./i18n";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "./loading";
import { AdministrationAlert } from "./notice";
import {
  type AdministrationSearchParams,
  loadAdministrationRefundAttention,
  loadAdministrationReservationsPage,
} from "./page-data.server";
import { AdministrationPage } from "./page-frame";
import { RefundAttention } from "./refund-attention";
import {
  getAdministrationReservationDateShortcuts,
  getAdministrationReservationListDefaultDateRange,
} from "./reservation-date-range";
import { reservationListQuery } from "./reservation-list-query";
import { ReservationLookup } from "./reservation-lookup";
import { ReservationTable } from "./reservation-table";
import {
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "./table-toolbar";

type ReservationsPage = ReturnType<typeof loadAdministrationReservationsPage>;
type ReservationsData = {
  readonly input: Awaited<ReservationsPage["input"]>;
  readonly result: Awaited<ReservationsPage["result"]>;
};

/**
 * The reservation list screen. It awaits only the route locale, which
 * prerendering knows, and streams the count, filters and table separately.
 */
export async function AdministrationReservationList({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = loadAdministrationReservationsPage(searchParams);
  const refundAttention = loadAdministrationRefundAttention();
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <h1 className="sr-only">
        {m.administrationReservationListTitle({}, { locale })}
      </h1>
      <Suspense fallback={null}>
        <ReservationRefundAttention count={refundAttention} input={input} />
      </Suspense>
      <AdministrationTableToolbar
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.administrationReservationListCountLoading(
                  {},
                  { locale }
                )}
              />
            }
          >
            <ReservationCount locale={locale} result={result} />
          </Suspense>
        }
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={4} />}>
            <ReservationFiltersContent input={input} />
          </Suspense>
        }
        exportHref={input.then(reservationListQuery.exportHref)}
        label={m.administrationReservationListToolbarLabel({}, { locale })}
        search={<ReservationLookup variant="toolbar" />}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            label={m.administrationReservationListLoading({}, { locale })}
            columns={6}
          />
        }
      >
        <ReservationResultsContent
          input={input}
          locale={locale}
          result={result}
        />
      </Suspense>
    </AdministrationPage>
  );
}

async function ReservationCount({
  locale,
  result,
}: {
  readonly locale: Locale;
  readonly result: Promise<ReservationsData["result"]>;
}) {
  const count = (await result).total;
  return (
    <AdministrationTableCount
      count={count}
      label={m.administrationReservationListCount({ count }, { locale })}
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
      query={resolvedInput}
      shortcuts={getAdministrationReservationDateShortcuts()}
    />
  );
}

async function ReservationResultsContent({
  input,
  locale,
  result,
}: {
  readonly input: Promise<ReservationsData["input"]>;
  readonly locale: Locale;
  readonly result: Promise<ReservationsData["result"]>;
}) {
  const [resolvedInput, resolvedResult] = await Promise.all([input, result]);
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
  return (
    <>
      {input.customerId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-blue/10 bg-white px-4 py-3 text-sm">
          <p>{m.administrationReservationListCustomerNotice({}, { locale })}</p>
          <Link
            className="font-semibold hover:underline"
            href={reservationListQuery.href({
              ...input,
              customerId: undefined,
            })}
          >
            {m.administrationReservationListCustomerClear({}, { locale })}
          </Link>
        </div>
      )}
      {result.dateFilterUnavailable && (
        <AdministrationAlert className="mb-4" status="warning">
          {m.administrationReservationListDateFilterUnavailable({}, { locale })}
        </AdministrationAlert>
      )}
      {result.dateSortUnavailable && (
        <AdministrationAlert className="mb-4" status="warning">
          {m.administrationReservationListDateSortUnavailable({}, { locale })}
        </AdministrationAlert>
      )}
      <ReservationTable query={input} reservations={result.items} />
      <Pagination
        href={(page) => reservationListQuery.href(input, { page })}
        locale={locale}
        page={result.page}
        pageCount={result.pageCount}
      />
    </>
  );
}
