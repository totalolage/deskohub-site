import { Search } from "lucide-react";
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
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

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
        description="Current statuses with booking and customer details."
        eyebrow="Operations"
        title="Reservations"
      />

      <form className="mb-5 grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-4 md:grid-cols-[minmax(14rem,1fr)_11rem_11rem_auto]">
        <div className="relative">
          <Search
            aria-hidden
            className="absolute left-3 top-3 size-4 text-navy-blue/65"
          />
          <Input
            aria-label="Reservation ID"
            className="pl-9"
            defaultValue={input.query}
            name="query"
            placeholder="Search reservation ID"
          />
        </div>
        <select
          aria-label="Status"
          className={selectClassName}
          defaultValue={input.status ?? ""}
          name="status"
        >
          <option value="">All statuses</option>
          <option value="attention">Needs attention</option>
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
          query: input.query,
          status: input.status,
          type: input.type,
        }}
      />
    </AdministrationPage>
  );
}
