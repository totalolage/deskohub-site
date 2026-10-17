import { InvoiceAdministrationDetailScreen } from "@/features/accounting/admin/invoice-detail-screen";

export default function InvoiceAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly invoiceId: string }>;
}) {
  return <InvoiceAdministrationDetailScreen params={params} />;
}
