import {
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationPage,
  AdministrationTableToolbar,
  BookingTable,
  Pagination,
} from "@/features/administration/components";
import {
  type AdministrationSearchParams,
  loadAdministrationBookings,
} from "@/features/administration/page-data.server";
import { Button } from "@/shared/components/ui/button";

export default async function BookingsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, result } = await loadAdministrationBookings(searchParams);
  return (
    <AdministrationPage>
      <h1 className="sr-only">Bookings</h1>
      <AdministrationTableToolbar
        count={result.total}
        filters={
          <AdministrationFilterForm variant="standalone">
            <AdministrationFilterField
              htmlFor="booking-date"
              label="Booking date"
            >
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
        }
        itemLabel="booking"
      />

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
