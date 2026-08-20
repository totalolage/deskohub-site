import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function NewInvoiceBreadcrumb() {
  return <AdministrationBreadcrumb segments={["invoices", "new"]} />;
}
