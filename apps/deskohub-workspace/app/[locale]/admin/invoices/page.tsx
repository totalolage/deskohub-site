import { InvoicesAdministrationScreen } from "@/features/accounting/admin/invoices-screen";
import type { InvoiceAdministrationSearchParams } from "@/features/accounting/admin/page-data.server";

export default function InvoiceAdministrationPage({
  searchParams,
}: {
  readonly searchParams: InvoiceAdministrationSearchParams;
}) {
  return <InvoicesAdministrationScreen searchParams={searchParams} />;
}
