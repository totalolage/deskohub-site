import Link from "next/link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  EmptyState,
  formatAdministrationDateTime,
  Pagination,
} from "@/features/administration/components";
import {
  type AdministrationSearchParams,
  loadAdministrationCustomers,
} from "@/features/administration/page-data.server";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";

export const dynamic = "force-dynamic";

export default async function DiscountCustomersAdminPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const customers = await loadAdministrationCustomers(searchParams);

  return (
    <AdministrationPage>
      <AdministrationPageHeader
        count={customers.total}
        description="Customers connected to reservations, plus exact lookup for discount administration."
        eyebrow="Operations"
        title="Customers"
      />
      <CustomerSearch />
      <section className="mt-7">
        <div className="mb-3">
          <h2 className="text-xl">Reservation customers</h2>
          <p className="mt-1 text-sm text-navy-blue/65">
            Customers with at least one reservation.
          </p>
        </div>
        {customers.items.length === 0 ? (
          <EmptyState message="No customers have reservations yet." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
            <ul className="divide-y divide-navy-blue/10">
              {customers.items.map((item) => (
                <li key={item.customerId}>
                  <Link
                    className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-navy-blue/[0.025] sm:flex-row sm:items-center sm:justify-between"
                    href={`/admin/customers/${item.customerId}`}
                  >
                    <div>
                      <p className="font-semibold">
                        {item.customer?.displayName ?? "Details unavailable"}
                      </p>
                      <p className="mt-1 text-sm text-navy-blue/65">
                        {item.customer?.email ??
                          item.customer?.phone ??
                          "Customer details unavailable"}
                      </p>
                    </div>
                    <div className="text-sm sm:text-right">
                      <p className="font-semibold">
                        {item.reservationCount}{" "}
                        {item.reservationCount === 1
                          ? "reservation"
                          : "reservations"}
                      </p>
                      <p className="mt-1 text-navy-blue/65">
                        Updated{" "}
                        {formatAdministrationDateTime(item.lastActivityAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Pagination
          basePath="/admin/customers"
          page={customers.page}
          pageCount={customers.pageCount}
        />
      </section>
    </AdministrationPage>
  );
}
