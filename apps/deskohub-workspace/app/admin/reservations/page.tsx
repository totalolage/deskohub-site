import Link from "next/link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  Pagination,
  ReservationTable,
} from "@/features/administration/components";
import {
  type AdministrationSearchParams,
  loadAdministrationReservations,
} from "@/features/administration/page-data.server";
import { ReservationLookup } from "@/features/administration/reservation-lookup";
import { Button } from "@/shared/components/ui/button";

export const dynamic = "force-dynamic";

const selectClassName =
  "h-10 rounded-lg border border-navy-blue/15 bg-white px-3 text-sm outline-none focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/15";

export default async function ReservationsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = await loadAdministrationReservations(searchParams);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        count={result.total}
        description="Bookings, customer details, and payment status in one operational view."
        title="Reservations"
      />

      <div className="mb-4">
        <ReservationLookup compact />
      </div>

      <form className="mb-5 grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-4 sm:grid-cols-2 xl:grid-cols-[11rem_13rem_12rem_auto_auto] xl:items-end xl:justify-start">
        <label className="grid gap-1.5 text-xs font-semibold text-navy-blue/65">
          Status
          <select
            className={selectClassName}
            defaultValue={input.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            <option value="in_progress">In progress</option>
            <option value="complete">Complete</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-navy-blue/65">
          Reservation type
          <select
            className={selectClassName}
            defaultValue={input.type ?? ""}
            name="type"
          >
            <option value="">All reservation types</option>
            <option value="cowork">Coworking</option>
            <option value="meeting-room">Meeting room</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-navy-blue/65">
          Start date
          <input
            className={selectClassName}
            defaultValue={input.date ?? ""}
            name="date"
            type="date"
          />
        </label>
        {input.customerId && (
          <input name="customerId" type="hidden" value={input.customerId} />
        )}
        <Button className="min-h-10" size="sm" type="submit">
          Apply filters
        </Button>
        {(input.customerId || input.date || input.status || input.type) && (
          <Button asChild className="min-h-10" size="sm" variant="ghost">
            <Link href="/admin/reservations">Clear</Link>
          </Button>
        )}
      </form>

      {input.customerId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-blue/10 bg-white px-4 py-3 text-sm">
          <p>Showing reservations for the selected customer.</p>
          <Link
            className="font-semibold hover:underline"
            href={`/admin/reservations${input.date ? `?date=${input.date}` : ""}`}
          >
            Clear customer
          </Link>
        </div>
      )}
      {result.dateFilterUnavailable && (
        <output className="mb-4 block rounded-lg bg-sunset-yellow/15 px-4 py-3 text-sm">
          Booking dates are temporarily unavailable. Try this date again
          shortly.
        </output>
      )}

      <ReservationTable reservations={result.items} />
      <Pagination
        basePath="/admin/reservations"
        page={result.page}
        pageCount={result.pageCount}
        params={{
          date: input.date,
          customerId: input.customerId,
          status: input.status,
          type: input.type,
        }}
      />
    </AdministrationPage>
  );
}
