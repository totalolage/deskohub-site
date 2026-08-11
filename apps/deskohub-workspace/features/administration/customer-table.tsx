import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import type { AdministrationCustomerSummary } from "./administration.service";
import { EmptyState } from "./empty-state";
import { formatAdministrationDateTime } from "./formatters";
import { AdministrationResponsiveTable } from "./table-frame";

export function AdministrationCustomerTable({
  customers,
}: {
  readonly customers: readonly AdministrationCustomerSummary[];
}) {
  if (customers.length === 0) {
    return <EmptyState message="No customers have reservations yet." />;
  }
  return (
    <AdministrationResponsiveTable
      desktop={
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
            {customers.map((item) => (
              <TableRow className="relative" key={item.customerId}>
                <TableCell>
                  <Link
                    className="font-semibold underline decoration-navy-blue/20 underline-offset-4 before:absolute before:inset-0 before:content-[''] hover:decoration-navy-blue focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-navy-blue/40"
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
                  <span className="font-semibold">{item.reservationCount}</span>{" "}
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
      }
      mobile={
        <ul className="divide-y divide-navy-blue/10">
          {customers.map((item) => (
            <li key={item.customerId}>
              <Link
                className="block px-4 py-4 transition-colors hover:bg-navy-blue/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-blue/40"
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
                  {item.reservationCount === 1 ? "reservation" : "reservations"}{" "}
                  · Updated {formatAdministrationDateTime(item.lastActivityAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      }
    />
  );
}
