import Link from "next/link";
import {
  AdministrationPage,
  EmptyState,
  formatAdministrationDateTime,
  Pagination,
} from "@/features/administration/components";
import {
  type AdministrationSearchParams,
  loadAdministrationCustomers,
} from "@/features/administration/page-data.server";
import { CustomerSearch } from "@/features/discounts/admin/customer-admin-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

export default async function DiscountCustomersAdminPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const customers = await loadAdministrationCustomers(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Customers</h1>
      <div className="grid gap-4 rounded-xl border border-navy-blue/10 bg-white p-4 lg:grid-cols-[auto_minmax(22rem,32rem)] lg:items-end lg:justify-between">
        <p className="pb-2 text-sm font-semibold text-navy-blue/70">
          {customers.total} customers
        </p>
        <CustomerSearch variant="toolbar" />
      </div>
      <section className="mt-7">
        {customers.items.length === 0 ? (
          <EmptyState message="No customers have reservations yet." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
            <div className="hidden overflow-x-auto md:block">
              <Table aria-label="Customers" className="min-w-[860px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Reservations</TableHead>
                    <TableHead>Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.items.map((item) => (
                    <TableRow className="relative" key={item.customerId}>
                      <TableCell>
                        <Link
                          className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-['']"
                          href={`/admin/customers/${item.customerId}`}
                        >
                          {item.customer?.displayName ?? "Details unavailable"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-navy-blue/68">
                        {item.customer?.email ?? "—"}
                      </TableCell>
                      <TableCell className="text-navy-blue/68">
                        {item.customer?.phone ?? "—"}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">
                          {item.reservationCount}
                        </span>{" "}
                        <span className="text-navy-blue/60">
                          {item.reservationCount === 1
                            ? "reservation"
                            : "reservations"}
                        </span>
                      </TableCell>
                      <TableCell className="text-navy-blue/68">
                        {formatAdministrationDateTime(item.lastActivityAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-navy-blue/10 md:hidden">
              {customers.items.map((item) => (
                <li key={item.customerId}>
                  <Link
                    className="block px-4 py-4 transition-colors hover:bg-navy-blue/[0.025]"
                    href={`/admin/customers/${item.customerId}`}
                  >
                    <p className="font-semibold">
                      {item.customer?.displayName ?? "Details unavailable"}
                    </p>
                    <p className="mt-1 text-sm text-navy-blue/65">
                      {item.customer?.email ??
                        item.customer?.phone ??
                        "Customer details unavailable"}
                    </p>
                    <p className="mt-3 text-xs text-navy-blue/60">
                      {item.reservationCount}{" "}
                      {item.reservationCount === 1
                        ? "reservation"
                        : "reservations"}{" "}
                      · Updated{" "}
                      {formatAdministrationDateTime(item.lastActivityAt)}
                    </p>
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
