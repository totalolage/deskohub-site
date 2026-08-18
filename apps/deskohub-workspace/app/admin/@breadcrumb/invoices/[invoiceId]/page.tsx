import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default async function InvoiceBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  return <AdministrationBreadcrumb segments={["invoices", invoiceId]} />;
}
