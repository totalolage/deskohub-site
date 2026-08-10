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
        description="Current statuses with booking and customer details."
        eyebrow="Operations"
        title="Reservations"
      />

      <div className="mb-5">
        <ReservationLookup />
      </div>

      {input.customerId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-blue/10 bg-white px-4 py-3 text-sm">
          <p>Showing reservations for the selected customer.</p>
          <Link
            className="font-semibold hover:underline"
            href="/admin/reservations"
          >
            Clear customer
          </Link>
        </div>
      )}

      <form className="mb-5 grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-4 md:grid-cols-[11rem_13rem_auto] md:justify-start">
        <select
          aria-label="Status"
          className={selectClassName}
          defaultValue={input.status ?? ""}
          name="status"
        >
          <option value="">All statuses</option>
          <option value="in_progress">In progress</option>
          <option value="complete">Complete</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          aria-label="Reservation type"
          className={selectClassName}
          defaultValue={input.type ?? ""}
          name="type"
        >
          <option value="">All reservation types</option>
          <option value="cowork">Coworking</option>
          <option value="meeting-room">Meeting room</option>
        </select>
        {input.customerId && (
          <input name="customerId" type="hidden" value={input.customerId} />
        )}
        {input.date && <input name="date" type="hidden" value={input.date} />}
        <Button size="sm" type="submit">
          Apply filters
        </Button>
      </form>

      {input.date && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy-blue/10 bg-white px-4 py-3 text-sm">
          <p>
            Showing reservations from <strong>{input.date}</strong>.
          </p>
          <Link
            className="font-semibold hover:underline"
            href="/admin/reservations"
          >
            Clear date
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
