import {
  AdministrationPage,
  AdministrationPageHeader,
  BookingTable,
  Pagination,
} from "@/features/administration/components";
import {
  type AdministrationSearchParams,
  loadAdministrationBookings,
} from "@/features/administration/page-data.server";
import { Button } from "@/shared/components/ui/button";

export const dynamic = "force-dynamic";

export default async function BookingsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = await loadAdministrationBookings(searchParams);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        count={result.total}
        description="Bookings recorded in Dotypos, with their customer, table, and linked Workspace reservation."
        eyebrow="Operations"
        title="Bookings"
      />

      <form className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-navy-blue/10 bg-white p-4">
        <label
          className="grid gap-1.5 text-sm font-semibold"
          htmlFor="booking-date"
        >
          Booking date
          <input
            className="h-10 rounded-lg border border-navy-blue/15 bg-white px-3 text-sm outline-none focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/15"
            defaultValue={input.date}
            id="booking-date"
            name="date"
            required
            type="date"
          />
        </label>
        <Button
          className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
          size="sm"
          type="submit"
        >
          Show bookings
        </Button>
      </form>

      <BookingTable bookings={result.items} />
      <Pagination
        basePath="/admin/bookings"
        page={result.page}
        pageCount={result.pageCount}
        params={{ date: input.date }}
      />
    </AdministrationPage>
  );
}
