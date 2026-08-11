import Link from "next/link";
import {
  AdministrationAlert,
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationFilterSelect,
  AdministrationPage,
  AdministrationTableToolbar,
  Pagination,
  ReservationTable,
} from "@/features/administration/components";
import {
  type AdministrationSearchParams,
  loadAdministrationReservations,
} from "@/features/administration/page-data.server";
import { ReservationLookup } from "@/features/administration/reservation-lookup";
import { Button } from "@/shared/components/ui/button";

export default async function ReservationsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = await loadAdministrationReservations(searchParams);
  const clearCustomerSearch = new URLSearchParams();
  for (const [key, value] of Object.entries({
    date: input.date,
    direction: input.direction,
    sort: input.sort,
    status: input.status,
    type: input.type,
  })) {
    if (value) clearCustomerSearch.set(key, value);
  }
  const clearCustomerQuery = clearCustomerSearch.toString();
  const clearCustomerHref = clearCustomerQuery
    ? `/admin/reservations?${clearCustomerQuery}`
    : "/admin/reservations";
  return (
    <AdministrationPage>
      <h1 className="sr-only">Reservations</h1>
      <AdministrationTableToolbar
        count={result.total}
        filters={
          <AdministrationFilterForm className="2xl:grid-cols-[11rem_13rem_12rem_auto_auto]">
            <AdministrationFilterField
              htmlFor="reservation-status"
              label="Deskohub status"
            >
              <AdministrationFilterSelect
                defaultValue={input.status ?? ""}
                id="reservation-status"
                name="status"
              >
                <option value="">All statuses</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
                <option value="cancelled">Cancelled</option>
              </AdministrationFilterSelect>
            </AdministrationFilterField>
            <AdministrationFilterField
              htmlFor="reservation-type"
              label="Reservation type"
            >
              <AdministrationFilterSelect
                defaultValue={input.type ?? ""}
                id="reservation-type"
                name="type"
              >
                <option value="">All reservation types</option>
                <option value="cowork">Coworking</option>
                <option value="meeting-room">Meeting room</option>
              </AdministrationFilterSelect>
            </AdministrationFilterField>
            <AdministrationFilterField
              htmlFor="reservation-date"
              label="Start date"
            >
              <AdministrationFilterInput
                defaultValue={input.date ?? ""}
                id="reservation-date"
                name="date"
                type="date"
              />
            </AdministrationFilterField>
            {input.customerId && (
              <input name="customerId" type="hidden" value={input.customerId} />
            )}
            <input name="sort" type="hidden" value={input.sort} />
            <input name="direction" type="hidden" value={input.direction} />
            <Button className="min-h-10" size="sm" type="submit">
              Apply filters
            </Button>
            {(input.customerId || input.date || input.status || input.type) && (
              <Button asChild className="min-h-10" size="sm" variant="ghost">
                <Link href="/admin/reservations">Clear</Link>
              </Button>
            )}
          </AdministrationFilterForm>
        }
        itemLabel="reservation"
        search={<ReservationLookup variant="toolbar" />}
      />

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
            date: input.date,
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
          date: input.date,
          customerId: input.customerId,
          direction: input.direction,
          sort: input.sort,
          status: input.status,
          type: input.type,
        }}
      />
    </AdministrationPage>
  );
}
